import { NextResponse } from "next/server";
import { tellerGet, TellerTransaction } from "@/lib/teller";
import { getDb } from "@/lib/db";
import { guessCategory } from "@/lib/categories";
import { v4 as uuidv4 } from "uuid";

// Map Teller's category strings → our category keys
function tellerCategoryToKey(cat: string | null): string {
  if (!cat) return "other";
  const map: Record<string, string> = {
    accommodation:           "travel",
    advertising:             "general_services",
    bar:                     "food_and_drink",
    charity:                 "other",
    clothing:                "shopping",
    dining:                  "food_and_drink",
    education:               "other",
    electronics:             "shopping",
    entertainment:           "entertainment",
    fuel:                    "transportation",
    groceries:               "food_and_drink",
    health:                  "medical",
    home:                    "home_improvement",
    income:                  "income",
    insurance:               "general_services",
    investment:              "transfer_in",
    loan:                    "loan_payments",
    office:                  "general_services",
    personal:                "personal_care",
    phone:                   "rent_and_utilities",
    restaurants:             "food_and_drink",
    shopping:                "shopping",
    software:                "entertainment",
    sport:                   "personal_care",
    tax:                     "government",
    transport:               "transportation",
    travel:                  "travel",
    utilities:               "rent_and_utilities",
  };
  return map[cat.toLowerCase()] ?? "other";
}

export async function POST() {
  try {
    const db = getDb();

    // Pull linked rows from both accounts AND credit_cards
    const linkedAccounts = db
      .prepare(
        `SELECT id, teller_access_token, teller_account_id
         FROM accounts WHERE teller_access_token IS NOT NULL`
      )
      .all() as { id: string; teller_access_token: string; teller_account_id: string }[];

    const linkedCards = db
      .prepare(
        `SELECT id, teller_access_token, teller_account_id
         FROM credit_cards WHERE teller_access_token IS NOT NULL`
      )
      .all() as { id: string; teller_access_token: string; teller_account_id: string }[];

    const linked = [...linkedAccounts, ...linkedCards];

    if (linked.length === 0) {
      return NextResponse.json({ added: 0, message: "No linked accounts" });
    }

    let totalAdded = 0;

    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO transactions
        (id, account_id, teller_transaction_id, amount, date, name, merchant_name,
         category, subcategory, transaction_type, is_manual)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `);

    for (const row of linked) {
      try {
        const transactions = await tellerGet<TellerTransaction[]>(
          `/accounts/${row.teller_account_id}/transactions`,
          row.teller_access_token
        );

        for (const tx of transactions) {
          if (tx.status === "pending") continue; // only sync posted transactions

          const amount = parseFloat(tx.amount);
          const tellerCat = tx.details?.category ?? null;
          const catKey = tellerCat
            ? tellerCategoryToKey(tellerCat)
            : guessCategory(tx.description, amount).category;

          // Teller: positive = debit (expense), negative = credit (income) — same as Plaid
          const txType =
            amount < 0 ? "income"
            : catKey.startsWith("transfer") ? "transfer"
            : "expense";

          const merchantName = tx.details?.counterparty?.name ?? null;

          insertStmt.run(
            uuidv4(),
            row.id,
            tx.id,
            amount,
            tx.date,
            tx.description,
            merchantName,
            catKey,
            null,
            txType,
          );
          totalAdded++;
        }
      } catch (e) {
        console.error(`Failed to sync transactions for account ${row.id}:`, e);
      }
    }

    return NextResponse.json({ added: totalAdded });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Teller sync-transactions error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
