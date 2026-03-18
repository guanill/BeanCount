import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Configuration, PlaidApi, PlaidEnvironments } from "npm:plaid@26";
import { corsHeaders } from "../_shared/cors.ts";
import { getSupabaseClient, getSupabaseAdmin } from "../_shared/supabase.ts";

function getPlaidClient() {
  const env = Deno.env.get("PLAID_ENV") || "sandbox";
  return new PlaidApi(
    new Configuration({
      basePath: (PlaidEnvironments as Record<string, string>)[env],
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": Deno.env.get("PLAID_CLIENT_ID"),
          "PLAID-SECRET": Deno.env.get("PLAID_SECRET"),
        },
      },
    })
  );
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = getSupabaseClient(req.headers.get("Authorization")!);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const admin = getSupabaseAdmin();
    const plaid = getPlaidClient();
    const { public_token, institution_name } = await req.json();

    const exchangeRes = await plaid.itemPublicTokenExchange({ public_token });
    const accessToken = exchangeRes.data.access_token;
    const itemId = exchangeRes.data.item_id;

    const balanceRes = await plaid.accountsBalanceGet({ access_token: accessToken });
    const plaidAccounts = balanceRes.data.accounts;
    const created: object[] = [];

    for (const pa of plaidAccounts) {
      const isCredit = pa.type === "credit";
      const name = `${institution_name} – ${pa.name}`;
      const now = new Date().toISOString();

      if (isCredit) {
        // Credit card → credit_cards table
        const balanceOwed = pa.balances.current ?? 0;
        const creditLimit = pa.balances.limit ?? 0;

        const { data: existing } = await admin
          .from("credit_cards").select("id")
          .eq("plaid_account_id", pa.account_id).eq("user_id", user.id).maybeSingle();

        if (existing) {
          await admin.from("credit_cards").update({
            balance_owed: balanceOwed, credit_limit: creditLimit,
            plaid_item_id: itemId, plaid_institution_name: institution_name,
            plaid_last_synced: now,
          }).eq("id", existing.id);

          await admin.from("integration_tokens").upsert({
            user_id: user.id, provider: "plaid", entity_type: "credit_card",
            entity_id: existing.id, access_token: accessToken,
          }, { onConflict: "provider,entity_type,entity_id" });

          created.push({ id: existing.id, name, balance_owed: balanceOwed, table: "credit_cards", updated: true });
        } else {
          const id = crypto.randomUUID();
          await admin.from("credit_cards").insert({
            id, user_id: user.id, name, balance_owed: balanceOwed,
            credit_limit: creditLimit, points_balance: 0, points_value_cents: 1,
            min_payment: 0, color: "#e17055",
            plaid_account_id: pa.account_id, plaid_item_id: itemId,
            plaid_institution_name: institution_name, plaid_last_synced: now,
          });

          await admin.from("integration_tokens").insert({
            user_id: user.id, provider: "plaid", entity_type: "credit_card",
            entity_id: id, access_token: accessToken,
          });

          created.push({ id, name, balance_owed: balanceOwed, table: "credit_cards", updated: false });
        }
      } else {
        // Depository / investment → accounts table
        const subtypeMap: Record<string, string> = {
          checking: "bank", savings: "bank", "money market": "bank",
          brokerage: "stock", "401k": "stock", ira: "stock",
        };
        const accountType = subtypeMap[pa.subtype as string] ?? (pa.type === "investment" ? "stock" : "bank");
        const balance = pa.balances.current ?? pa.balances.available ?? 0;

        const { data: existing } = await admin
          .from("accounts").select("id")
          .eq("plaid_account_id", pa.account_id).eq("user_id", user.id).maybeSingle();

        if (existing) {
          await admin.from("accounts").update({
            balance, plaid_item_id: itemId,
            plaid_institution_name: institution_name,
            plaid_last_synced: now,
          }).eq("id", existing.id);

          await admin.from("integration_tokens").upsert({
            user_id: user.id, provider: "plaid", entity_type: "account",
            entity_id: existing.id, access_token: accessToken,
          }, { onConflict: "provider,entity_type,entity_id" });

          created.push({ id: existing.id, name, balance, table: "accounts", updated: true });
        } else {
          const id = crypto.randomUUID();
          await admin.from("accounts").insert({
            id, user_id: user.id, name, type: accountType, balance,
            icon: "landmark", color: "#4a9eed",
            plaid_account_id: pa.account_id, plaid_item_id: itemId,
            plaid_institution_name: institution_name, plaid_last_synced: now,
          });

          await admin.from("integration_tokens").insert({
            user_id: user.id, provider: "plaid", entity_type: "account",
            entity_id: id, access_token: accessToken,
          });

          created.push({ id, name, balance, table: "accounts", updated: false });
        }
      }
    }

    return new Response(JSON.stringify({ success: true, accounts: created }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
