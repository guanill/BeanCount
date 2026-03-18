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

    const { data: linked } = await admin.from("integration_tokens")
      .select("entity_id, access_token")
      .eq("user_id", user.id).eq("provider", "plaid").eq("entity_type", "account");

    if (!linked?.length) return new Response(JSON.stringify({ synced: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const entityIds = linked.map((r) => r.entity_id);
    const { data: accounts } = await admin.from("accounts").select("id, plaid_account_id").in("id", entityIds);
    if (!accounts?.length) return new Response(JSON.stringify({ synced: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const tokenByEntityId = new Map(linked.map((r) => [r.entity_id, r.access_token]));
    const byToken = new Map<string, { id: string; plaid_account_id: string }[]>();
    for (const account of accounts) {
      const token = tokenByEntityId.get(account.id);
      if (!token) continue;
      const list = byToken.get(token) ?? [];
      list.push(account);
      byToken.set(token, list);
    }

    let synced = 0;
    for (const [accessToken, rows] of byToken.entries()) {
      const res = await plaid.accountsBalanceGet({ access_token: accessToken });
      for (const pa of res.data.accounts) {
        const matched = rows.find((r) => r.plaid_account_id === pa.account_id);
        if (!matched) continue;
        const balance = pa.balances.current ?? pa.balances.available ?? 0;
        await admin.from("accounts").update({ balance, plaid_last_synced: new Date().toISOString() }).eq("id", matched.id);
        synced++;
      }
    }

    return new Response(JSON.stringify({ synced }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
