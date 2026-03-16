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
    const { id } = await req.json();

    const { data: tokenRow } = await admin.from("integration_tokens")
      .select("access_token")
      .eq("entity_id", id).eq("provider", "plaid").eq("entity_type", "account").eq("user_id", user.id)
      .maybeSingle();

    if (tokenRow?.access_token) {
      try { await plaid.itemRemove({ access_token: tokenRow.access_token }); } catch { /* non-critical */ }
    }

    await admin.from("integration_tokens").delete()
      .eq("entity_id", id).eq("provider", "plaid").eq("user_id", user.id);

    await admin.from("accounts").update({
      plaid_account_id: null, plaid_item_id: null,
      plaid_institution_name: null, plaid_last_synced: null,
    }).eq("id", id).eq("user_id", user.id);

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
