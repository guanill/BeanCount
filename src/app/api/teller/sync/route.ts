import { NextResponse } from "next/server";
import { tellerGet, TellerBalance } from "@/lib/teller";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

interface SyncError {
  id: string;
  name: string;
  kind: "account" | "credit_card";
  code: string;
  message: string;
}

function parseTellerError(e: unknown): { code: string; message: string } {
  const msg = e instanceof Error ? e.message : String(e);
  // Extract Teller error code from messages like: Error: Teller 404: {"error":{"code":"enrollment.disconnected...","message":"..."}}
  try {
    const jsonStart = msg.indexOf("{");
    if (jsonStart !== -1) {
      const parsed = JSON.parse(msg.slice(jsonStart)) as { error?: { code?: string; message?: string } };
      if (parsed.error?.code) {
        return { code: parsed.error.code, message: parsed.error.message ?? msg };
      }
    }
  } catch { /* ignore */ }
  return { code: "unknown", message: msg };
}

export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    let synced = 0;
    const errors: SyncError[] = [];

    // ── Bank accounts ────────────────────────────────────────────────────────
    const { data: accountTokens } = await supabaseAdmin
      .from("integration_tokens")
      .select("entity_id, access_token")
      .eq("user_id", user.id)
      .eq("provider", "teller")
      .eq("entity_type", "account");

    if (accountTokens && accountTokens.length > 0) {
      const accountIds = accountTokens.map((t) => t.entity_id);
      const { data: accounts } = await supabaseAdmin
        .from("accounts")
        .select("id, name, teller_account_id")
        .in("id", accountIds);

      const tokenByEntityId = new Map(accountTokens.map((t) => [t.entity_id, t.access_token]));

      for (const row of accounts ?? []) {
        const accessToken = tokenByEntityId.get(row.id);
        if (!accessToken || !row.teller_account_id) continue;

        try {
          const bal = await tellerGet<TellerBalance>(
            `/accounts/${row.teller_account_id}/balances`,
            accessToken
          );
          const balance = parseFloat(bal.available ?? bal.ledger ?? "0");
          await supabaseAdmin
            .from("accounts")
            .update({
              balance,
              teller_last_synced: new Date().toISOString(),
            })
            .eq("id", row.id);
          synced++;
        } catch (e) {
          console.error(`Failed to sync account ${row.id}:`, e);
          const { code, message } = parseTellerError(e);
          errors.push({ id: row.id, name: row.name, kind: "account", code, message });
        }
      }
    }

    // ── Credit cards ─────────────────────────────────────────────────────────
    const { data: cardTokens } = await supabaseAdmin
      .from("integration_tokens")
      .select("entity_id, access_token")
      .eq("user_id", user.id)
      .eq("provider", "teller")
      .eq("entity_type", "credit_card");

    if (cardTokens && cardTokens.length > 0) {
      const cardIds = cardTokens.map((t) => t.entity_id);
      const { data: cards } = await supabaseAdmin
        .from("credit_cards")
        .select("id, name, teller_account_id")
        .in("id", cardIds);

      const tokenByEntityId = new Map(cardTokens.map((t) => [t.entity_id, t.access_token]));

      for (const row of cards ?? []) {
        const accessToken = tokenByEntityId.get(row.id);
        if (!accessToken || !row.teller_account_id) continue;

        try {
          const bal = await tellerGet<TellerBalance>(
            `/accounts/${row.teller_account_id}/balances`,
            accessToken
          );
          const balance_owed = Math.abs(parseFloat(bal.ledger ?? "0"));
          await supabaseAdmin
            .from("credit_cards")
            .update({
              balance_owed,
              teller_last_synced: new Date().toISOString(),
            })
            .eq("id", row.id);
          synced++;
        } catch (e) {
          console.error(`Failed to sync credit card ${row.id}:`, e);
          const { code, message } = parseTellerError(e);
          errors.push({ id: row.id, name: row.name, kind: "credit_card", code, message });
        }
      }
    }

    return NextResponse.json({ synced, errors });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Teller sync error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
