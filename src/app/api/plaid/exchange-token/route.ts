import { NextRequest, NextResponse } from "next/server";
import { plaidClient } from "@/lib/plaid";
import { getDb } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";

export async function POST(req: NextRequest) {
  try {
    const { public_token, institution_name } = await req.json();

    // Exchange public token for access token
    const exchangeRes = await plaidClient.itemPublicTokenExchange({ public_token });
    const accessToken = exchangeRes.data.access_token;
    const itemId = exchangeRes.data.item_id;

    // Fetch accounts + balances from Plaid
    const balanceRes = await plaidClient.accountsBalanceGet({ access_token: accessToken });
    const plaidAccounts = balanceRes.data.accounts;

    const db = getDb();

    const created: object[] = [];

    for (const pa of plaidAccounts) {
      // Skip investment / loan sub-types for now — only depository
      const subtypeMap: Record<string, string> = {
        checking: "bank",
        savings: "bank",
        "money market": "bank",
        brokerage: "stock",
        "401k": "stock",
        ira: "stock",
      };
      const accountType =
        subtypeMap[pa.subtype as string] ??
        (pa.type === "investment" ? "stock" : "bank");

      const balance = pa.balances.current ?? pa.balances.available ?? 0;
      const name = `${institution_name} – ${pa.name}`;
      const id = uuidv4();

      // Check if this plaid_account_id is already tracked
      const existing = db
        .prepare("SELECT id FROM accounts WHERE plaid_account_id = ?")
        .get(pa.account_id) as { id: string } | undefined;

      if (existing) {
        // Update balance
        db.prepare(
          `UPDATE accounts SET balance = ?, plaid_access_token = ?, plaid_item_id = ?,
           plaid_institution_name = ?, plaid_last_synced = datetime('now'),
           updated_at = datetime('now') WHERE id = ?`
        ).run(balance, accessToken, itemId, institution_name, existing.id);
        created.push({ id: existing.id, name, balance, updated: true });
      } else {
        // Insert new account
        db.prepare(
          `INSERT INTO accounts
             (id, name, type, balance, icon, color,
              plaid_access_token, plaid_account_id, plaid_item_id,
              plaid_institution_name, plaid_last_synced)
           VALUES (?, ?, ?, ?, 'landmark', '#4a9eed', ?, ?, ?, ?, datetime('now'))`
        ).run(id, name, accountType, balance, accessToken, pa.account_id, itemId, institution_name);
        created.push({ id, name, balance, updated: false });
      }
    }

    return NextResponse.json({ success: true, accounts: created });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Plaid exchange-token error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
