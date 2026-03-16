/**
 * Fix migration: insert orphaned transactions (null account_id) + remaining tables
 */
import Database from "better-sqlite3";
import { createClient } from "@supabase/supabase-js";
import path from "path";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const USER_ID = process.env.MIGRATION_USER_ID!;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const db = new Database(path.join(process.cwd(), "budget.db"));

// Valid account IDs from Supabase
const VALID_ACCOUNT_IDS = new Set([
  "afcaecdf-69ab-4f34-9cca-88f7fd8367eb",
  "7bbdc702-5eee-476c-83fa-09dc3e1ddb15",
  "a794bfdf-8690-4831-8084-0c92bc11cb55",
  "d58f6ef9-4051-4bbf-afa6-df929d9af958",
  "e8c09303-2b95-4ee6-9398-85f0fa14b911",
  "b92e2273-59a6-4f12-b4a1-d3f843edcacb",
  "901a20b4-a13a-4b45-85ef-de86920edc01",
  "21ea1f0a-c47d-4441-86aa-b6f7b6190dbd",
]);

async function main() {
  // 1. Get IDs of transactions already in Supabase
  const { data: existing } = await supabase.from("transactions").select("id");
  const existingIds = new Set((existing || []).map((r: any) => r.id));
  console.log(`Already migrated: ${existingIds.size} transactions`);

  // 2. Get all SQLite transactions not yet migrated
  const allTx = db.prepare("SELECT * FROM transactions").all() as any[];
  const missing = allTx.filter((r: any) => !existingIds.has(r.id));
  console.log(`Missing transactions to migrate: ${missing.length}`);

  // 3. Insert with orphaned account_ids set to null
  const transformed = missing.map((row: any) => ({
    id: row.id,
    user_id: USER_ID,
    account_id: VALID_ACCOUNT_IDS.has(row.account_id) ? row.account_id : null,
    plaid_transaction_id: row.plaid_transaction_id || null,
    teller_transaction_id: row.teller_transaction_id || null,
    amount: row.amount,
    date: row.date,
    name: row.name,
    merchant_name: row.merchant_name || null,
    category: row.category,
    subcategory: row.subcategory || null,
    transaction_type: row.transaction_type,
    is_manual: row.is_manual === 1,
    is_ignored: (row.is_ignored ?? 0) === 1,
    notes: row.notes || null,
    created_at: row.created_at,
  }));

  for (let i = 0; i < transformed.length; i += 100) {
    const batch = transformed.slice(i, i + 100);
    const { error } = await supabase.from("transactions").insert(batch);
    if (error) {
      console.error(`Batch ${i}: ${error.message}`);
      // Try individually
      for (const row of batch) {
        const { error: e } = await supabase.from("transactions").insert(row);
        if (e) console.error(`  Row ${row.id}: ${e.message}`);
      }
    } else {
      console.log(`  Transactions batch ${i}: ${batch.length} rows OK`);
    }
  }

  // 4. Liabilities
  const liabilities = db.prepare("SELECT * FROM liabilities").all() as any[];
  if (liabilities.length > 0) {
    const { error } = await supabase.from("liabilities").insert(
      liabilities.map((row: any) => ({
        id: row.id, user_id: USER_ID, name: row.name, amount: row.amount,
        category: row.category, notes: row.notes || null, due_date: row.due_date || null,
        created_at: row.created_at, updated_at: row.updated_at,
      }))
    );
    if (error) console.error("liabilities:", error.message);
    else console.log(`  liabilities: ${liabilities.length} rows OK`);
  } else {
    console.log("  liabilities: 0 rows (skipped)");
  }

  // 5. Loans
  const loans = db.prepare("SELECT * FROM loans").all() as any[];
  if (loans.length > 0) {
    const { error } = await supabase.from("loans").insert(
      loans.map((row: any) => ({
        id: row.id, user_id: USER_ID, name: row.name, type: row.type,
        balance: row.balance, original_amount: row.original_amount || null,
        interest_rate: row.interest_rate, monthly_payment: row.monthly_payment,
        notes: row.notes || null, deferral_months: row.deferral_months ?? 0,
        deferral_type: row.deferral_type ?? "unsubsidized",
        created_at: row.created_at, updated_at: row.updated_at,
      }))
    );
    if (error) console.error("loans:", error.message);
    else console.log(`  loans: ${loans.length} rows OK`);
  } else {
    console.log("  loans: 0 rows (skipped)");
  }

  // 6. Plaid sync cursors
  const cursors = db.prepare("SELECT * FROM plaid_sync_cursors").all() as any[];
  if (cursors.length > 0) {
    const { error } = await supabase.from("plaid_sync_cursors").insert(
      cursors.map((row: any) => ({
        item_id: row.item_id, user_id: USER_ID, cursor: row.cursor,
      }))
    );
    if (error) console.error("plaid_sync_cursors:", error.message);
    else console.log(`  plaid_sync_cursors: ${cursors.length} rows OK`);
  } else {
    console.log("  plaid_sync_cursors: 0 rows (skipped)");
  }

  // Verify
  console.log("\nFinal counts:");
  const tables = ["accounts", "credit_cards", "debts_owed", "transactions", "liabilities", "loans", "plaid_sync_cursors", "integration_tokens"];
  for (const t of tables) {
    const { count } = await supabase.from(t).select("*", { count: "exact", head: true });
    const sqliteCount = t === "integration_tokens" ? 7 : (db.prepare(`SELECT COUNT(*) as c FROM ${t}`).get() as any).c;
    console.log(`  ${t}: SQLite=${sqliteCount} Supabase=${count} ${count === sqliteCount ? "OK" : "MISMATCH"}`);
  }
}

main().catch(console.error);
