import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { getSupabaseClient, getSupabaseAdmin } from "../_shared/supabase.ts";
import { tellerFetch, TellerBalance, parseTellerError } from "../_shared/teller.ts";

interface SyncError {
  id: string;
  name: string;
  kind: "account" | "credit_card";
  code: string;
  message: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = getSupabaseClient(req.headers.get("Authorization")!);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const admin = getSupabaseAdmin();
    let synced = 0;
    const errors: SyncError[] = [];

    // Bank accounts
    const { data: accountTokens } = await admin.from("integration_tokens")
      .select("entity_id, access_token")
      .eq("user_id", user.id).eq("provider", "teller").eq("entity_type", "account");

    if (accountTokens?.length) {
      const accountIds = accountTokens.map((t) => t.entity_id);
      const { data: accounts } = await admin.from("accounts")
        .select("id, name, teller_account_id").in("id", accountIds);
      const tokenByEntityId = new Map(accountTokens.map((t) => [t.entity_id, t.access_token]));

      for (const row of accounts ?? []) {
        const accessToken = tokenByEntityId.get(row.id);
        if (!accessToken || !row.teller_account_id) continue;
        try {
          const bal = await tellerFetch<TellerBalance>(`/accounts/${row.teller_account_id}/balances`, accessToken);
          const balance = parseFloat(bal.available ?? bal.ledger ?? "0");
          await admin.from("accounts").update({ balance, teller_last_synced: new Date().toISOString() }).eq("id", row.id);
          synced++;
        } catch (e) {
          const { code, message } = parseTellerError(e);
          errors.push({ id: row.id, name: row.name, kind: "account", code, message });
        }
      }
    }

    // Credit cards
    const { data: cardTokens } = await admin.from("integration_tokens")
      .select("entity_id, access_token")
      .eq("user_id", user.id).eq("provider", "teller").eq("entity_type", "credit_card");

    if (cardTokens?.length) {
      const cardIds = cardTokens.map((t) => t.entity_id);
      const { data: cards } = await admin.from("credit_cards")
        .select("id, name, teller_account_id").in("id", cardIds);
      const tokenByEntityId = new Map(cardTokens.map((t) => [t.entity_id, t.access_token]));

      for (const row of cards ?? []) {
        const accessToken = tokenByEntityId.get(row.id);
        if (!accessToken || !row.teller_account_id) continue;
        try {
          const bal = await tellerFetch<TellerBalance>(`/accounts/${row.teller_account_id}/balances`, accessToken);
          const balance_owed = Math.abs(parseFloat(bal.ledger ?? "0"));
          await admin.from("credit_cards").update({ balance_owed, teller_last_synced: new Date().toISOString() }).eq("id", row.id);
          synced++;
        } catch (e) {
          const { code, message } = parseTellerError(e);
          errors.push({ id: row.id, name: row.name, kind: "credit_card", code, message });
        }
      }
    }

    return new Response(JSON.stringify({ synced, errors }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
