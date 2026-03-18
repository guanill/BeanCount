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

    // Fetch all plaid-linked tokens (accounts + credit cards)
    const { data: linked } = await admin.from("integration_tokens")
      .select("entity_id, entity_type, access_token")
      .eq("user_id", user.id).eq("provider", "plaid");

    if (!linked?.length) return new Response(JSON.stringify({ synced: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Fetch accounts and credit cards separately
    const accountTokens = linked.filter((r) => r.entity_type === "account");
    const cardTokens = linked.filter((r) => r.entity_type === "credit_card");

    const accountIds = accountTokens.map((r) => r.entity_id);
    const cardIds = cardTokens.map((r) => r.entity_id);

    const { data: accounts } = accountIds.length
      ? await admin.from("accounts").select("id, plaid_account_id").in("id", accountIds)
      : { data: [] as { id: string; plaid_account_id: string }[] };

    const { data: cards } = cardIds.length
      ? await admin.from("credit_cards").select("id, plaid_account_id").in("id", cardIds)
      : { data: [] as { id: string; plaid_account_id: string }[] };

    // Build a unified lookup: plaid_account_id → { id, table }
    type SyncTarget = { id: string; plaid_account_id: string; table: "accounts" | "credit_cards" };
    const allTargets: SyncTarget[] = [
      ...(accounts ?? []).map((a) => ({ ...a, table: "accounts" as const })),
      ...(cards ?? []).map((c) => ({ ...c, table: "credit_cards" as const })),
    ];

    // Group by access token
    const tokenByEntityId = new Map(linked.map((r) => [r.entity_id, r.access_token]));
    const byToken = new Map<string, SyncTarget[]>();
    for (const target of allTargets) {
      const token = tokenByEntityId.get(target.id);
      if (!token) continue;
      const list = byToken.get(token) ?? [];
      list.push(target);
      byToken.set(token, list);
    }

    let synced = 0;
    const errors: { id: string; name: string; kind: string; code: string; message: string }[] = [];

    for (const [accessToken, rows] of byToken.entries()) {
      try {
        const res = await plaid.accountsBalanceGet({ access_token: accessToken });
        for (const pa of res.data.accounts) {
          const matched = rows.find((r) => r.plaid_account_id === pa.account_id);
          if (!matched) continue;
          const now = new Date().toISOString();

          if (matched.table === "credit_cards") {
            const balanceOwed = pa.balances.current ?? 0;
            const creditLimit = pa.balances.limit ?? 0;
            await admin.from("credit_cards").update({
              balance_owed: balanceOwed, credit_limit: creditLimit, plaid_last_synced: now,
            }).eq("id", matched.id);
          } else {
            const balance = pa.balances.current ?? pa.balances.available ?? 0;
            await admin.from("accounts").update({ balance, plaid_last_synced: now }).eq("id", matched.id);
          }
          synced++;
        }
      } catch (err) {
        for (const row of rows) {
          errors.push({ id: row.id, name: "", kind: row.table === "credit_cards" ? "credit_card" : "account", code: "PLAID_ERROR", message: (err as Error).message });
        }
      }
    }

    return new Response(JSON.stringify({ synced, errors }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
