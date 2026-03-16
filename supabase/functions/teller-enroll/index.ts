import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { getSupabaseClient, getSupabaseAdmin } from "../_shared/supabase.ts";
import { tellerFetch, TellerAccount, TellerBalance } from "../_shared/teller.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Missing Authorization header" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const supabase = getSupabaseClient(authHeader);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: authError?.message ?? "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const admin = getSupabaseAdmin();
    const { access_token, enrollment_id, institution_name } = await req.json();

    const tellerAccounts = await tellerFetch<TellerAccount[]>("/accounts", access_token);
    const created: object[] = [];

    for (const ta of tellerAccounts) {
      if (ta.status !== "open") continue;

      let balance = 0;
      if (ta.links.balances) {
        try {
          const bal = await tellerFetch<TellerBalance>(`/accounts/${ta.id}/balances`, access_token);
          balance = ta.type === "credit"
            ? Math.abs(parseFloat(bal.ledger ?? "0"))
            : parseFloat(bal.available ?? bal.ledger ?? "0");
        } catch { balance = 0; }
      }

      const name = `${institution_name} – ${ta.name}`;

      if (ta.type === "credit") {
        const { data: existing } = await admin.from("credit_cards").select("id")
          .eq("teller_account_id", ta.id).eq("user_id", user.id).maybeSingle();

        if (existing) {
          await admin.from("credit_cards").update({
            balance_owed: balance, teller_enrollment_id: enrollment_id,
            teller_institution_name: institution_name, teller_last_synced: new Date().toISOString(),
          }).eq("id", existing.id);

          await admin.from("integration_tokens").upsert({
            user_id: user.id, provider: "teller", entity_type: "credit_card",
            entity_id: existing.id, access_token,
          }, { onConflict: "provider,entity_type,entity_id" });

          created.push({ id: existing.id, name, balance, table: "credit_cards", updated: true });
        } else {
          const id = crypto.randomUUID();
          await admin.from("credit_cards").insert({
            id, user_id: user.id, name, balance_owed: balance,
            credit_limit: 0, points_balance: 0, points_value_cents: 1,
            teller_account_id: ta.id, teller_enrollment_id: enrollment_id,
            teller_institution_name: institution_name, teller_last_synced: new Date().toISOString(),
          });

          await admin.from("integration_tokens").insert({
            user_id: user.id, provider: "teller", entity_type: "credit_card",
            entity_id: id, access_token,
          });

          created.push({ id, name, balance, table: "credit_cards" });
        }
      } else {
        const { data: existing } = await admin.from("accounts").select("id")
          .eq("teller_account_id", ta.id).eq("user_id", user.id).maybeSingle();

        if (existing) {
          await admin.from("accounts").update({
            balance, teller_enrollment_id: enrollment_id,
            teller_institution_name: institution_name, teller_last_synced: new Date().toISOString(),
          }).eq("id", existing.id);

          await admin.from("integration_tokens").upsert({
            user_id: user.id, provider: "teller", entity_type: "account",
            entity_id: existing.id, access_token,
          }, { onConflict: "provider,entity_type,entity_id" });

          created.push({ id: existing.id, name, balance, table: "accounts", updated: true });
        } else {
          const id = crypto.randomUUID();
          await admin.from("accounts").insert({
            id, user_id: user.id, name, type: "bank", balance,
            teller_account_id: ta.id, teller_enrollment_id: enrollment_id,
            teller_institution_name: institution_name, teller_last_synced: new Date().toISOString(),
          });

          await admin.from("integration_tokens").insert({
            user_id: user.id, provider: "teller", entity_type: "account",
            entity_id: id, access_token,
          });

          created.push({ id, name, balance, table: "accounts" });
        }
      }
    }

    return new Response(JSON.stringify({ created }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("teller-enroll error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message, stack: (err as Error).stack }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
