import { NextRequest, NextResponse } from "next/server";
import { tellerGet, TellerAccount, TellerBalance } from "@/lib/teller";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { v4 as uuidv4 } from "uuid";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { access_token, enrollment_id, institution_name } = await req.json() as {
      access_token: string;
      enrollment_id: string;
      institution_name: string;
    };

    // Fetch all accounts for this enrollment
    const tellerAccounts = await tellerGet<TellerAccount[]>("/accounts", access_token);

    const created: object[] = [];

    for (const ta of tellerAccounts) {
      if (ta.status !== "open") continue;

      // Fetch live balance
      let balance = 0;
      if (ta.links.balances) {
        try {
          const bal = await tellerGet<TellerBalance>(
            `/accounts/${ta.id}/balances`,
            access_token
          );
          // Credit: ledger = amount owed (positive); Depository: available balance
          balance = ta.type === "credit"
            ? Math.abs(parseFloat(bal.ledger ?? "0"))
            : parseFloat(bal.available ?? bal.ledger ?? "0");
        } catch {
          balance = 0;
        }
      }

      const name = `${institution_name} – ${ta.name}`;

      if (ta.type === "credit") {
        // ── Credit card → credit_cards table ──────────────────────────────
        const { data: existing } = await supabaseAdmin
          .from("credit_cards")
          .select("id")
          .eq("teller_account_id", ta.id)
          .eq("user_id", user.id)
          .maybeSingle();

        if (existing) {
          await supabaseAdmin
            .from("credit_cards")
            .update({
              balance_owed: balance,
              teller_enrollment_id: enrollment_id,
              teller_institution_name: institution_name,
              teller_last_synced: new Date().toISOString(),
            })
            .eq("id", existing.id);

          // Upsert access token
          await supabaseAdmin
            .from("integration_tokens")
            .upsert(
              {
                user_id: user.id,
                provider: "teller",
                entity_type: "credit_card",
                entity_id: existing.id,
                access_token,
              },
              { onConflict: "provider,entity_type,entity_id" }
            );

          created.push({ id: existing.id, name, balance, table: "credit_cards", updated: true });
        } else {
          const id = uuidv4();
          await supabaseAdmin
            .from("credit_cards")
            .insert({
              id,
              user_id: user.id,
              name,
              balance_owed: balance,
              credit_limit: 0,
              points_balance: 0,
              points_value_cents: 1,
              teller_account_id: ta.id,
              teller_enrollment_id: enrollment_id,
              teller_institution_name: institution_name,
              teller_last_synced: new Date().toISOString(),
            });

          // Store access token
          await supabaseAdmin
            .from("integration_tokens")
            .insert({
              user_id: user.id,
              provider: "teller",
              entity_type: "credit_card",
              entity_id: id,
              access_token,
            });

          created.push({ id, name, balance, table: "credit_cards" });
        }
      } else {
        // ── Depository (checking/savings) → accounts table ─────────────────
        const { data: existing } = await supabaseAdmin
          .from("accounts")
          .select("id")
          .eq("teller_account_id", ta.id)
          .eq("user_id", user.id)
          .maybeSingle();

        if (existing) {
          await supabaseAdmin
            .from("accounts")
            .update({
              balance,
              teller_enrollment_id: enrollment_id,
              teller_institution_name: institution_name,
              teller_last_synced: new Date().toISOString(),
            })
            .eq("id", existing.id);

          // Upsert access token
          await supabaseAdmin
            .from("integration_tokens")
            .upsert(
              {
                user_id: user.id,
                provider: "teller",
                entity_type: "account",
                entity_id: existing.id,
                access_token,
              },
              { onConflict: "provider,entity_type,entity_id" }
            );

          created.push({ id: existing.id, name, balance, table: "accounts", updated: true });
        } else {
          const id = uuidv4();
          await supabaseAdmin
            .from("accounts")
            .insert({
              id,
              user_id: user.id,
              name,
              type: "bank",
              balance,
              icon: null,
              color: null,
              teller_account_id: ta.id,
              teller_enrollment_id: enrollment_id,
              teller_institution_name: institution_name,
              teller_last_synced: new Date().toISOString(),
            });

          // Store access token
          await supabaseAdmin
            .from("integration_tokens")
            .insert({
              user_id: user.id,
              provider: "teller",
              entity_type: "account",
              entity_id: id,
              access_token,
            });

          created.push({ id, name, balance, table: "accounts" });
        }
      }
    }

    return NextResponse.json({ created });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Teller enroll error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
