import { NextResponse } from "next/server";
import { tellerGet, TellerBalance } from "@/lib/teller";
import { getDb } from "@/lib/db";

export async function POST() {
  try {
    const db = getDb();
    let synced = 0;

    // ── Bank accounts ────────────────────────────────────────────────────────
    const linkedAccounts = db
      .prepare(
        `SELECT id, teller_access_token, teller_account_id
         FROM accounts WHERE teller_access_token IS NOT NULL`
      )
      .all() as { id: string; teller_access_token: string; teller_account_id: string }[];

    for (const row of linkedAccounts) {
      try {
        const bal = await tellerGet<TellerBalance>(
          `/accounts/${row.teller_account_id}/balances`,
          row.teller_access_token
        );
        const balance = parseFloat(bal.available ?? bal.ledger ?? "0");
        db.prepare(
          `UPDATE accounts
           SET balance = ?, teller_last_synced = datetime('now'), updated_at = datetime('now')
           WHERE id = ?`
        ).run(balance, row.id);
        synced++;
      } catch (e) {
        console.error(`Failed to sync account ${row.id}:`, e);
      }
    }

    // ── Credit cards ─────────────────────────────────────────────────────────
    const linkedCards = db
      .prepare(
        `SELECT id, teller_access_token, teller_account_id
         FROM credit_cards WHERE teller_access_token IS NOT NULL`
      )
      .all() as { id: string; teller_access_token: string; teller_account_id: string }[];

    for (const row of linkedCards) {
      try {
        const bal = await tellerGet<TellerBalance>(
          `/accounts/${row.teller_account_id}/balances`,
          row.teller_access_token
        );
        // Credit: ledger = balance owed (negative means card owes you)
        const balance_owed = parseFloat(bal.ledger ?? "0");
        db.prepare(
          `UPDATE credit_cards
           SET balance_owed = ?, teller_last_synced = datetime('now'), updated_at = datetime('now')
           WHERE id = ?`
        ).run(balance_owed, row.id);
        synced++;
      } catch (e) {
        console.error(`Failed to sync credit card ${row.id}:`, e);
      }
    }

    if (synced === 0 && linkedAccounts.length === 0 && linkedCards.length === 0) {
      return NextResponse.json({ synced: 0 });
    }

    return NextResponse.json({ synced });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Teller sync error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
