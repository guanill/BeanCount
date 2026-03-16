/**
 * One-time migration script: SQLite → Supabase
 *
 * Usage:
 *   1. Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and MIGRATION_USER_ID env vars
 *   2. Run: npx tsx scripts/migrate-to-supabase.ts
 *
 * Prerequisites:
 *   - Run supabase/schema.sql in the Supabase SQL editor first
 *   - Create a user in Supabase Auth and note the UUID
 */

import Database from "better-sqlite3";
import { createClient } from "@supabase/supabase-js";
import path from "path";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const USER_ID = process.env.MIGRATION_USER_ID;

if (!SUPABASE_URL || !SUPABASE_KEY || !USER_ID) {
  console.error("Missing env vars. Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and MIGRATION_USER_ID");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const db = new Database(path.join(process.cwd(), "budget.db"));
db.pragma("journal_mode = WAL");

async function migrateTable<T extends Record<string, unknown>>(
  tableName: string,
  transform: (row: any) => T,
) {
  const rows = db.prepare(`SELECT * FROM ${tableName}`).all();
  if (rows.length === 0) {
    console.log(`  ${tableName}: 0 rows (skipped)`);
    return;
  }

  const transformed = rows.map(transform);

  // Insert in batches of 100
  for (let i = 0; i < transformed.length; i += 100) {
    const batch = transformed.slice(i, i + 100);
    const { error } = await supabase.from(tableName).insert(batch);
    if (error) {
      console.error(`  ${tableName} batch ${i}: ERROR`, error.message);
      // Try one by one for the failed batch
      for (const row of batch) {
        const { error: singleError } = await supabase.from(tableName).insert(row);
        if (singleError) {
          console.error(`    Row failed:`, singleError.message, JSON.stringify(row).slice(0, 200));
        }
      }
    }
  }

  console.log(`  ${tableName}: ${rows.length} rows migrated`);
}

async function main() {
  console.log("Starting migration...\n");

  // 1. Accounts
  await migrateTable("accounts", (row) => ({
    id: row.id,
    user_id: USER_ID,
    name: row.name,
    type: row.type,
    balance: row.balance,
    currency: row.currency || "USD",
    icon: row.icon || null,
    color: row.color || null,
    plaid_account_id: row.plaid_account_id || null,
    plaid_item_id: row.plaid_item_id || null,
    plaid_institution_name: row.plaid_institution_name || null,
    plaid_last_synced: row.plaid_last_synced || null,
    teller_account_id: row.teller_account_id || null,
    teller_enrollment_id: row.teller_enrollment_id || null,
    teller_institution_name: row.teller_institution_name || null,
    teller_last_synced: row.teller_last_synced || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));

  // 2. Extract integration tokens from accounts (Plaid)
  const plaidAccounts = db
    .prepare("SELECT id, plaid_access_token FROM accounts WHERE plaid_access_token IS NOT NULL")
    .all() as any[];
  for (const acc of plaidAccounts) {
    const { error } = await supabase.from("integration_tokens").insert({
      user_id: USER_ID,
      provider: "plaid",
      entity_type: "account",
      entity_id: acc.id,
      access_token: acc.plaid_access_token,
    });
    if (error) console.error("  integration_tokens (plaid account):", error.message);
  }
  console.log(`  integration_tokens (plaid accounts): ${plaidAccounts.length} tokens`);

  // 3. Extract integration tokens from accounts (Teller)
  const tellerAccounts = db
    .prepare("SELECT id, teller_access_token FROM accounts WHERE teller_access_token IS NOT NULL")
    .all() as any[];
  for (const acc of tellerAccounts) {
    const { error } = await supabase.from("integration_tokens").insert({
      user_id: USER_ID,
      provider: "teller",
      entity_type: "account",
      entity_id: acc.id,
      access_token: acc.teller_access_token,
    });
    if (error) console.error("  integration_tokens (teller account):", error.message);
  }
  console.log(`  integration_tokens (teller accounts): ${tellerAccounts.length} tokens`);

  // 4. Credit Cards
  await migrateTable("credit_cards", (row) => ({
    id: row.id,
    user_id: USER_ID,
    name: row.name,
    balance_owed: row.balance_owed,
    credit_limit: row.credit_limit,
    points_balance: row.points_balance,
    points_value_cents: row.points_value_cents,
    due_date: row.due_date || null,
    min_payment: row.min_payment,
    color: row.color || null,
    teller_account_id: row.teller_account_id || null,
    teller_enrollment_id: row.teller_enrollment_id || null,
    teller_institution_name: row.teller_institution_name || null,
    teller_last_synced: row.teller_last_synced || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));

  // 5. Extract integration tokens from credit_cards (Teller)
  const tellerCards = db
    .prepare("SELECT id, teller_access_token FROM credit_cards WHERE teller_access_token IS NOT NULL")
    .all() as any[];
  for (const card of tellerCards) {
    const { error } = await supabase.from("integration_tokens").insert({
      user_id: USER_ID,
      provider: "teller",
      entity_type: "credit_card",
      entity_id: card.id,
      access_token: card.teller_access_token,
    });
    if (error) console.error("  integration_tokens (teller card):", error.message);
  }
  console.log(`  integration_tokens (teller cards): ${tellerCards.length} tokens`);

  // 6. Debts Owed
  await migrateTable("debts_owed", (row) => ({
    id: row.id,
    user_id: USER_ID,
    person_name: row.person_name,
    amount: row.amount,
    reason: row.reason || null,
    due_date: row.due_date || null,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));

  // 7. Transactions
  await migrateTable("transactions", (row) => ({
    id: row.id,
    user_id: USER_ID,
    account_id: row.account_id || null,
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

  // 8. Liabilities
  await migrateTable("liabilities", (row) => ({
    id: row.id,
    user_id: USER_ID,
    name: row.name,
    amount: row.amount,
    category: row.category,
    notes: row.notes || null,
    due_date: row.due_date || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));

  // 9. Loans
  await migrateTable("loans", (row) => ({
    id: row.id,
    user_id: USER_ID,
    name: row.name,
    type: row.type,
    balance: row.balance,
    original_amount: row.original_amount || null,
    interest_rate: row.interest_rate,
    monthly_payment: row.monthly_payment,
    notes: row.notes || null,
    deferral_months: row.deferral_months ?? 0,
    deferral_type: row.deferral_type ?? "unsubsidized",
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));

  // 10. Plaid Sync Cursors
  await migrateTable("plaid_sync_cursors", (row) => ({
    item_id: row.item_id,
    user_id: USER_ID,
    cursor: row.cursor,
  }));

  console.log("\nMigration complete!");

  // Verify row counts
  console.log("\nVerifying...");
  const tables = ["accounts", "credit_cards", "debts_owed", "transactions", "liabilities", "loans", "plaid_sync_cursors", "integration_tokens"];
  for (const table of tables) {
    const sqliteCount = table === "integration_tokens"
      ? plaidAccounts.length + tellerAccounts.length + tellerCards.length
      : (db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as any).c;
    const { count } = await supabase.from(table).select("*", { count: "exact", head: true });
    const match = count === sqliteCount ? "OK" : "MISMATCH";
    console.log(`  ${table}: SQLite=${sqliteCount} Supabase=${count} [${match}]`);
  }
}

main().catch(console.error);
