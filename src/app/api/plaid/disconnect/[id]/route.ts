import { NextRequest, NextResponse } from "next/server";
import { plaidClient } from "@/lib/plaid";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;

    // Get access token from integration_tokens
    const { data: tokenRow } = await supabaseAdmin
      .from("integration_tokens")
      .select("access_token")
      .eq("entity_id", id)
      .eq("provider", "plaid")
      .eq("entity_type", "account")
      .eq("user_id", user.id)
      .maybeSingle();

    if (tokenRow?.access_token) {
      // Notify Plaid to revoke access
      try {
        await plaidClient.itemRemove({ access_token: tokenRow.access_token });
      } catch {
        // Non-critical — continue even if Plaid call fails
      }
    }

    // Delete token from integration_tokens
    await supabaseAdmin
      .from("integration_tokens")
      .delete()
      .eq("entity_id", id)
      .eq("provider", "plaid")
      .eq("user_id", user.id);

    // Clear plaid fields on account
    await supabaseAdmin
      .from("accounts")
      .update({
        plaid_account_id: null,
        plaid_item_id: null,
        plaid_institution_name: null,
        plaid_last_synced: null,
      })
      .eq("id", id)
      .eq("user_id", user.id);

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
