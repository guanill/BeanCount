import { NextResponse } from "next/server";
import { plaidClient } from "@/lib/plaid";
import { getDb } from "@/lib/db";

export async function POST() {
  try {
    const db = getDb();

    // Find all accounts that have a Plaid access token
    const linked = db
      .prepare(
        "SELECT id, plaid_access_token, plaid_account_id FROM accounts WHERE plaid_access_token IS NOT NULL"
      )
      .all() as { id: string; plaid_access_token: string; plaid_account_id: string }[];

    if (linked.length === 0) {
      return NextResponse.json({ synced: 0 });
    }

    // Group by access token (one item can have many accounts)
    const byToken = new Map<string, typeof linked>();
    for (const row of linked) {
      const list = byToken.get(row.plaid_access_token) ?? [];
      list.push(row);
      byToken.set(row.plaid_access_token, list);
    }

    let synced = 0;

    for (const [accessToken, rows] of byToken.entries()) {
      const res = await plaidClient.accountsBalanceGet({ access_token: accessToken });

      for (const pa of res.data.accounts) {
        const matched = rows.find((r) => r.plaid_account_id === pa.account_id);
        if (!matched) continue;

        const balance = pa.balances.current ?? pa.balances.available ?? 0;
        db.prepare(
          `UPDATE accounts SET balance = ?, plaid_last_synced = datetime('now'), updated_at = datetime('now') WHERE id = ?`
        ).run(balance, matched.id);
        synced++;
      }
    }

    return NextResponse.json({ synced });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Plaid sync error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
