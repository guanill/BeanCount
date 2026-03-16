import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { getSupabaseClient, getSupabaseAdmin } from "../_shared/supabase.ts";
import { tellerFetch } from "../_shared/teller.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = getSupabaseClient(req.headers.get("Authorization")!);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const admin = getSupabaseAdmin();
    const { id } = await req.json();

    const { data: accountRow } = await admin.from("accounts")
      .select("teller_account_id").eq("id", id).eq("user_id", user.id).maybeSingle();

    const { data: cardRow } = await admin.from("credit_cards")
      .select("teller_account_id").eq("id", id).eq("user_id", user.id).maybeSingle();

    const row = accountRow ?? cardRow;

    const { data: tokenRow } = await admin.from("integration_tokens")
      .select("access_token")
      .eq("entity_id", id).eq("provider", "teller").eq("user_id", user.id).maybeSingle();

    if (tokenRow?.access_token && row?.teller_account_id) {
      try { await tellerFetch<void>(`/accounts/${row.teller_account_id}`, tokenRow.access_token, "DELETE"); } catch { /* non-critical */ }
    }

    await admin.from("integration_tokens").delete()
      .eq("entity_id", id).eq("provider", "teller").eq("user_id", user.id);

    if (accountRow) {
      await admin.from("accounts").update({
        teller_account_id: null, teller_enrollment_id: null,
        teller_institution_name: null, teller_last_synced: null,
      }).eq("id", id).eq("user_id", user.id);
    } else if (cardRow) {
      await admin.from("credit_cards").update({
        teller_account_id: null, teller_enrollment_id: null,
        teller_institution_name: null, teller_last_synced: null,
      }).eq("id", id).eq("user_id", user.id);
    }

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
