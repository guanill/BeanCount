import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "budget.db");

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    initializeDb(db);
  }
  return db;
}

function initializeDb(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('bank', 'stock', 'crypto')),
      balance REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      icon TEXT,
      color TEXT,
      plaid_access_token TEXT,
      plaid_account_id TEXT,
      plaid_item_id TEXT,
      plaid_institution_name TEXT,
      plaid_last_synced TEXT,
      teller_access_token TEXT,
      teller_account_id TEXT,
      teller_enrollment_id TEXT,
      teller_institution_name TEXT,
      teller_last_synced TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS credit_cards (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      balance_owed REAL NOT NULL DEFAULT 0,
      credit_limit REAL NOT NULL DEFAULT 0,
      points_balance REAL NOT NULL DEFAULT 0,
      points_value_cents REAL NOT NULL DEFAULT 1,
      due_date TEXT,
      min_payment REAL NOT NULL DEFAULT 0,
      color TEXT,
      teller_access_token TEXT,
      teller_account_id TEXT,
      teller_enrollment_id TEXT,
      teller_institution_name TEXT,
      teller_last_synced TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS debts_owed (
      id TEXT PRIMARY KEY,
      person_name TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      reason TEXT,
      due_date TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'partial', 'paid')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT,
      plaid_transaction_id TEXT UNIQUE,
      teller_transaction_id TEXT,
      amount REAL NOT NULL,
      date TEXT NOT NULL,
      name TEXT NOT NULL,
      merchant_name TEXT,
      category TEXT NOT NULL DEFAULT 'other',
      subcategory TEXT,
      transaction_type TEXT NOT NULL DEFAULT 'expense'
        CHECK(transaction_type IN ('income','expense','transfer')),
      is_manual INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS plaid_sync_cursors (
      item_id TEXT PRIMARY KEY,
      cursor TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS liabilities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT 'other',
      notes TEXT,
      due_date TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS loans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'personal',
      balance REAL NOT NULL DEFAULT 0,
      original_amount REAL,
      interest_rate REAL NOT NULL DEFAULT 0,
      monthly_payment REAL NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Migrate existing databases: add missing columns if they don't exist yet
  const accountCols = [
    "plaid_access_token TEXT",
    "plaid_account_id TEXT",
    "plaid_item_id TEXT",
    "plaid_institution_name TEXT",
    "plaid_last_synced TEXT",
    "teller_access_token TEXT",
    "teller_account_id TEXT",
    "teller_enrollment_id TEXT",
    "teller_institution_name TEXT",
    "teller_last_synced TEXT",
  ];
  for (const col of accountCols) {
    const colName = col.split(" ")[0];
    try {
      db.exec(`ALTER TABLE accounts ADD COLUMN ${col}`);
    } catch {
      void colName;
    }
  }

  // Migrate credit_cards table
  const creditCardCols = [
    "teller_access_token TEXT",
    "teller_account_id TEXT",
    "teller_enrollment_id TEXT",
    "teller_institution_name TEXT",
    "teller_last_synced TEXT",
  ];
  for (const col of creditCardCols) {
    const colName = col.split(" ")[0];
    try {
      db.exec(`ALTER TABLE credit_cards ADD COLUMN ${col}`);
    } catch {
      void colName;
    }
  }

  // Migrate transactions table
  const txCols = ["teller_transaction_id TEXT"];
  for (const col of txCols) {
    const colName = col.split(" ")[0];
    try {
      db.exec(`ALTER TABLE transactions ADD COLUMN ${col}`);
    } catch {
      void colName;
    }
  }
  // Create unique index separately (ALTER TABLE ADD COLUMN doesn't support UNIQUE in SQLite)
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_teller_transaction_id
    ON transactions(teller_transaction_id)
    WHERE teller_transaction_id IS NOT NULL
  `);

  // Migrate loans table — deferral support
  const loanCols = [
    "deferral_months INTEGER NOT NULL DEFAULT 0",
    "deferral_type TEXT NOT NULL DEFAULT 'unsubsidized'",
  ];
  for (const col of loanCols) {
    try { db.exec(`ALTER TABLE loans ADD COLUMN ${col}`); } catch { /* already exists */ }
  }
}
