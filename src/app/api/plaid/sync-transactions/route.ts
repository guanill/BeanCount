import { NextResponse } from "next/server";
import { plaidClient } from "@/lib/plaid";
import { getDb } from "@/lib/db";
import { plaidCategoryToKey, guessCategory } from "@/lib/categories";
import { v4 as uuidv4 } from "uuid";

export async function POST() {
  try {
    const db = getDb();

    // Find all unique Plaid items (access tokens)
    const items = db
      .prepare(`
        SELECT DISTINCT plaid_access_token, plaid_item_id
        FROM accounts
        WHERE plaid_access_token IS NOT NULL AND plaid_item_id IS NOT NULL
      `)
      .all() as { plaid_access_token: string; plaid_item_id: string }[];

    if (items.length === 0) {
      return NextResponse.json({ added: 0, message: "No linked accounts" });
    }

    let totalAdded = 0;

    for (const item of items) {
      // Get or create cursor for this item
      const cursorRow = db
        .prepare("SELECT cursor FROM plaid_sync_cursors WHERE item_id = ?")
        .get(item.plaid_item_id) as { cursor: string } | undefined;

      let cursor = cursorRow?.cursor ?? "";
      let hasMore = true;

      while (hasMore) {
        const response = await plaidClient.transactionsSync({
          access_token: item.plaid_access_token,
          cursor: cursor || undefined,
        });

        const { added, modified, removed, next_cursor, has_more } = response.data;

        // Build a map of plaid_account_id → our account id
        const accountMap = new Map<string, string>();
        const accountRows = db
          .prepare("SELECT id, plaid_account_id FROM accounts WHERE plaid_item_id = ?")
          .all(item.plaid_item_id) as { id: string; plaid_account_id: string }[];
        for (const row of accountRows) {
          if (row.plaid_account_id) accountMap.set(row.plaid_account_id, row.id);
        }

        // Insert new transactions
        const insertStmt = db.prepare(`
          INSERT OR IGNORE INTO transactions
            (id, account_id, plaid_transaction_id, amount, date, name, merchant_name,
             category, subcategory, transaction_type, is_manual)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        `);

        for (const tx of added) {
          const plaidPrimary =
            (tx.personal_finance_category as { primary?: string } | null)?.primary ?? "";
          const catKey   = plaidPrimary ? plaidCategoryToKey(plaidPrimary) : guessCategory(tx.name, tx.amount).category;
          const txType   =
            tx.amount < 0 ? "income"
            : catKey.startsWith("transfer") ? "transfer"
            : "expense";

          insertStmt.run(
            uuidv4(),
            accountMap.get(tx.account_id) ?? null,
            tx.transaction_id,
            tx.amount,
            tx.date,
            tx.name,
            tx.merchant_name ?? null,
            catKey,
            (tx.personal_finance_category as { detailed?: string } | null)?.detailed ?? null,
            txType,
          );
          totalAdded++;
        }

        // Update modified transactions
        for (const tx of modified) {
          const plaidPrimary =
            (tx.personal_finance_category as { primary?: string } | null)?.primary ?? "";
          const catKey = plaidPrimary ? plaidCategoryToKey(plaidPrimary) : "other";
          const txType =
            tx.amount < 0 ? "income"
            : catKey.startsWith("transfer") ? "transfer"
            : "expense";

          db.prepare(`
            UPDATE transactions SET amount=?, date=?, name=?, merchant_name=?, category=?, transaction_type=?
            WHERE plaid_transaction_id=?
          `).run(tx.amount, tx.date, tx.name, tx.merchant_name ?? null, catKey, txType, tx.transaction_id);
        }

        // Remove deleted transactions
        for (const tx of removed) {
          db.prepare("DELETE FROM transactions WHERE plaid_transaction_id = ?").run(
            tx.transaction_id
          );
        }

        cursor  = next_cursor;
        hasMore = has_more;
      }

      // Persist latest cursor
      db.prepare(`
        INSERT INTO plaid_sync_cursors (item_id, cursor) VALUES (?, ?)
        ON CONFLICT(item_id) DO UPDATE SET cursor = excluded.cursor
      `).run(item.plaid_item_id, cursor);
    }

    return NextResponse.json({ added: totalAdded });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("sync-transactions error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
