import { NextRequest, NextResponse } from "next/server";
import { tellerDelete } from "@/lib/teller";
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

    // Check accounts table first
    const { data: accountRow } = await supabaseAdmin
      .from("accounts")
      .select("teller_account_id")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();

    // Check credit_cards table
    const { data: cardRow } = await supabaseAdmin
      .from("credit_cards")
      .select("teller_account_id")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();

    const row = accountRow ?? cardRow;

    // Get the access token from integration_tokens
    const entityType = accountRow ? "account" : "credit_card";
    const { data: tokenRow } = await supabaseAdmin
      .from("integration_tokens")
      .select("access_token")
      .eq("entity_id", id)
      .eq("provider", "teller")
      .eq("user_id", user.id)
      .maybeSingle();

    if (tokenRow?.access_token && row?.teller_account_id) {
      try {
        await tellerDelete(`/accounts/${row.teller_account_id}`, tokenRow.access_token);
      } catch {
        // Non-critical
      }
    }

    // Delete token from integration_tokens
    await supabaseAdmin
      .from("integration_tokens")
      .delete()
      .eq("entity_id", id)
      .eq("provider", "teller")
      .eq("user_id", user.id);

    if (accountRow) {
      await supabaseAdmin
        .from("accounts")
        .update({
          teller_account_id: null,
          teller_enrollment_id: null,
          teller_institution_name: null,
          teller_last_synced: null,
        })
        .eq("id", id)
        .eq("user_id", user.id);
    } else if (cardRow) {
      await supabaseAdmin
        .from("credit_cards")
        .update({
          teller_account_id: null,
          teller_enrollment_id: null,
          teller_institution_name: null,
          teller_last_synced: null,
        })
        .eq("id", id)
        .eq("user_id", user.id);
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
