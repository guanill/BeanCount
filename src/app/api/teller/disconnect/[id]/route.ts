import { NextRequest, NextResponse } from "next/server";
import { tellerDelete } from "@/lib/teller";
import { getDb } from "@/lib/db";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();

    // Check accounts table first
    const accountRow = db
      .prepare("SELECT teller_access_token, teller_account_id FROM accounts WHERE id = ?")
      .get(id) as { teller_access_token: string; teller_account_id: string } | undefined;

    // Check credit_cards table
    const cardRow = db
      .prepare("SELECT teller_access_token, teller_account_id FROM credit_cards WHERE id = ?")
      .get(id) as { teller_access_token: string; teller_account_id: string } | undefined;

    const row = accountRow ?? cardRow;

    if (row?.teller_access_token && row?.teller_account_id) {
      try {
        await tellerDelete(`/accounts/${row.teller_account_id}`, row.teller_access_token);
      } catch {
        // Non-critical
      }
    }

    if (accountRow) {
      db.prepare(
        `UPDATE accounts
         SET teller_access_token = NULL, teller_account_id = NULL,
             teller_enrollment_id = NULL, teller_institution_name = NULL,
             teller_last_synced = NULL, updated_at = datetime('now')
         WHERE id = ?`
      ).run(id);
    } else if (cardRow) {
      db.prepare(
        `UPDATE credit_cards
         SET teller_access_token = NULL, teller_account_id = NULL,
             teller_enrollment_id = NULL, teller_institution_name = NULL,
             teller_last_synced = NULL, updated_at = datetime('now')
         WHERE id = ?`
      ).run(id);
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
