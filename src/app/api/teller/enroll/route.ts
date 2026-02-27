import { NextRequest, NextResponse } from "next/server";
import { tellerGet, TellerAccount, TellerBalance } from "@/lib/teller";
import { getDb } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";

export async function POST(req: NextRequest) {
  try {
    const { access_token, enrollment_id, institution_name } = await req.json() as {
      access_token: string;
      enrollment_id: string;
      institution_name: string;
    };

    // Fetch all accounts for this enrollment
    const tellerAccounts = await tellerGet<TellerAccount[]>("/accounts", access_token);

    const db = getDb();
    const created: object[] = [];

    for (const ta of tellerAccounts) {
      if (ta.status !== "open") continue;

      // Fetch live balance
      let balance = 0;
      if (ta.links.balances) {
        try {
          const bal = await tellerGet<TellerBalance>(
            `/accounts/${ta.id}/balances`,
            access_token
          );
          // Credit: ledger = amount owed (positive); Depository: available balance
          balance = ta.type === "credit"
            ? Math.abs(parseFloat(bal.ledger ?? "0"))
            : parseFloat(bal.available ?? bal.ledger ?? "0");
        } catch {
          balance = 0;
        }
      }

      const name = `${institution_name} – ${ta.name}`;

      if (ta.type === "credit") {
        // ── Credit card → credit_cards table ──────────────────────────────
        const existing = db
          .prepare("SELECT id FROM credit_cards WHERE teller_account_id = ?")
          .get(ta.id) as { id: string } | undefined;

        if (existing) {
          db.prepare(
            `UPDATE credit_cards
             SET balance_owed = ?, teller_access_token = ?, teller_enrollment_id = ?,
                 teller_institution_name = ?, teller_last_synced = datetime('now'),
                 updated_at = datetime('now')
             WHERE id = ?`
          ).run(balance, access_token, enrollment_id, institution_name, existing.id);
          created.push({ id: existing.id, name, balance, table: "credit_cards", updated: true });
        } else {
          const id = uuidv4();
          db.prepare(
            `INSERT INTO credit_cards
               (id, name, balance_owed, credit_limit, points_balance, points_value_cents,
                teller_access_token, teller_account_id, teller_enrollment_id,
                teller_institution_name, teller_last_synced)
             VALUES (?, ?, ?, 0, 0, 1, ?, ?, ?, ?, datetime('now'))`
          ).run(id, name, balance, access_token, ta.id, enrollment_id, institution_name);
          created.push({ id, name, balance, table: "credit_cards" });
        }
      } else {
        // ── Depository (checking/savings) → accounts table ─────────────────
        const existing = db
          .prepare("SELECT id FROM accounts WHERE teller_account_id = ?")
          .get(ta.id) as { id: string } | undefined;

        if (existing) {
          db.prepare(
            `UPDATE accounts
             SET balance = ?, teller_access_token = ?, teller_enrollment_id = ?,
                 teller_institution_name = ?, teller_last_synced = datetime('now'),
                 updated_at = datetime('now')
             WHERE id = ?`
          ).run(balance, access_token, enrollment_id, institution_name, existing.id);
          created.push({ id: existing.id, name, balance, table: "accounts", updated: true });
        } else {
          const id = uuidv4();
          db.prepare(
            `INSERT INTO accounts
               (id, name, type, balance, icon, color,
                teller_access_token, teller_account_id, teller_enrollment_id,
                teller_institution_name, teller_last_synced)
             VALUES (?, ?, 'bank', ?, NULL, NULL, ?, ?, ?, ?, datetime('now'))`
          ).run(id, name, balance, access_token, ta.id, enrollment_id, institution_name);
          created.push({ id, name, balance, table: "accounts" });
        }
      }
    }

    return NextResponse.json({ created });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Teller enroll error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
