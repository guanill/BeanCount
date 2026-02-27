import { NextRequest, NextResponse } from "next/server";
import { plaidClient } from "@/lib/plaid";
import { getDb } from "@/lib/db";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();

    const row = db
      .prepare("SELECT plaid_access_token FROM accounts WHERE id = ?")
      .get(id) as { plaid_access_token: string } | undefined;

    if (row?.plaid_access_token) {
      // Notify Plaid to revoke access
      try {
        await plaidClient.itemRemove({ access_token: row.plaid_access_token });
      } catch {
        // Non-critical — continue even if Plaid call fails
      }
    }

    db.prepare(
      `UPDATE accounts SET plaid_access_token = NULL, plaid_account_id = NULL,
       plaid_item_id = NULL, plaid_institution_name = NULL, plaid_last_synced = NULL,
       updated_at = datetime('now') WHERE id = ?`
    ).run(id);

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
