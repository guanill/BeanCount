-- ============================================================
-- BeanCount: Supabase PostgreSQL Schema
-- Run this in the Supabase SQL Editor to create all tables
-- ============================================================

-- Custom enums
CREATE TYPE account_type AS ENUM ('bank', 'stock', 'crypto');
CREATE TYPE transaction_type AS ENUM ('income', 'expense', 'transfer');
CREATE TYPE debt_status AS ENUM ('pending', 'partial', 'paid');
CREATE TYPE deferral_type AS ENUM ('subsidized', 'unsubsidized');
CREATE TYPE integration_provider AS ENUM ('plaid', 'teller');
CREATE TYPE integration_entity AS ENUM ('account', 'credit_card');

-- ============================================================
-- ACCOUNTS
-- ============================================================
CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  type account_type NOT NULL,
  balance numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  icon text,
  color text,
  -- Plaid metadata (no access token — stored in integration_tokens)
  plaid_account_id text,
  plaid_item_id text,
  plaid_institution_name text,
  plaid_last_synced timestamptz,
  -- Teller metadata
  teller_account_id text,
  teller_enrollment_id text,
  teller_institution_name text,
  teller_last_synced timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_accounts_user_id ON accounts(user_id);
CREATE INDEX idx_accounts_plaid_account_id ON accounts(plaid_account_id) WHERE plaid_account_id IS NOT NULL;
CREATE INDEX idx_accounts_teller_account_id ON accounts(teller_account_id) WHERE teller_account_id IS NOT NULL;

-- ============================================================
-- CREDIT CARDS
-- ============================================================
CREATE TABLE credit_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  balance_owed numeric NOT NULL DEFAULT 0,
  credit_limit numeric NOT NULL DEFAULT 0,
  points_balance numeric NOT NULL DEFAULT 0,
  points_value_cents numeric NOT NULL DEFAULT 1,
  due_date date,
  min_payment numeric NOT NULL DEFAULT 0,
  color text,
  -- Teller metadata
  teller_account_id text,
  teller_enrollment_id text,
  teller_institution_name text,
  teller_last_synced timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_credit_cards_user_id ON credit_cards(user_id);
CREATE INDEX idx_credit_cards_teller_account_id ON credit_cards(teller_account_id) WHERE teller_account_id IS NOT NULL;

-- ============================================================
-- DEBTS OWED
-- ============================================================
CREATE TABLE debts_owed (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  person_name text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  reason text,
  due_date date,
  status debt_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_debts_owed_user_id ON debts_owed(user_id);

-- ============================================================
-- TRANSACTIONS
-- ============================================================
CREATE TABLE transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  plaid_transaction_id text UNIQUE,
  teller_transaction_id text,
  amount numeric NOT NULL,
  date date NOT NULL,
  name text NOT NULL,
  merchant_name text,
  category text NOT NULL DEFAULT 'other',
  subcategory text,
  transaction_type transaction_type NOT NULL DEFAULT 'expense',
  is_manual boolean NOT NULL DEFAULT false,
  is_ignored boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_transactions_user_id_date ON transactions(user_id, date DESC);
CREATE INDEX idx_transactions_account_id ON transactions(account_id) WHERE account_id IS NOT NULL;
CREATE UNIQUE INDEX idx_teller_transaction_id ON transactions(teller_transaction_id) WHERE teller_transaction_id IS NOT NULL;

-- ============================================================
-- LIABILITIES
-- ============================================================
CREATE TABLE liabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  category text NOT NULL DEFAULT 'other',
  notes text,
  due_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_liabilities_user_id ON liabilities(user_id);

-- ============================================================
-- LOANS
-- ============================================================
CREATE TABLE loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'personal',
  balance numeric NOT NULL DEFAULT 0,
  original_amount numeric,
  interest_rate numeric NOT NULL DEFAULT 0,
  monthly_payment numeric NOT NULL DEFAULT 0,
  notes text,
  deferral_months integer NOT NULL DEFAULT 0,
  deferral_type deferral_type NOT NULL DEFAULT 'unsubsidized',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_loans_user_id ON loans(user_id);

-- ============================================================
-- PLAID SYNC CURSORS
-- ============================================================
CREATE TABLE plaid_sync_cursors (
  item_id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cursor text NOT NULL DEFAULT ''
);

CREATE INDEX idx_plaid_sync_cursors_user_id ON plaid_sync_cursors(user_id);

-- ============================================================
-- INTEGRATION TOKENS (sensitive — tighter RLS)
-- ============================================================
CREATE TABLE integration_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider integration_provider NOT NULL,
  entity_type integration_entity NOT NULL,
  entity_id uuid NOT NULL,
  access_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_integration_tokens_user_entity ON integration_tokens(user_id, entity_id);
CREATE INDEX idx_integration_tokens_provider ON integration_tokens(user_id, provider);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

-- Helper: standard user-owns-row policies
DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'accounts', 'credit_cards', 'debts_owed', 'transactions',
    'liabilities', 'loans', 'plaid_sync_cursors'
  ])
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format(
      'CREATE POLICY "Users can select own rows" ON %I FOR SELECT USING (auth.uid() = user_id)', tbl);
    EXECUTE format(
      'CREATE POLICY "Users can insert own rows" ON %I FOR INSERT WITH CHECK (auth.uid() = user_id)', tbl);
    EXECUTE format(
      'CREATE POLICY "Users can update own rows" ON %I FOR UPDATE USING (auth.uid() = user_id)', tbl);
    EXECUTE format(
      'CREATE POLICY "Users can delete own rows" ON %I FOR DELETE USING (auth.uid() = user_id)', tbl);
  END LOOP;
END $$;

-- Integration tokens: only service_role can read/write (API routes use service role key)
ALTER TABLE integration_tokens ENABLE ROW LEVEL SECURITY;
-- No anon/authenticated policies = only service_role can access

-- ============================================================
-- AUTO-UPDATE updated_at TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'accounts', 'credit_cards', 'debts_owed', 'liabilities', 'loans'
  ])
  LOOP
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at()', tbl);
  END LOOP;
END $$;

-- ============================================================
-- ENABLE REALTIME
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE accounts;
ALTER PUBLICATION supabase_realtime ADD TABLE credit_cards;
ALTER PUBLICATION supabase_realtime ADD TABLE transactions;
ALTER PUBLICATION supabase_realtime ADD TABLE debts_owed;
ALTER PUBLICATION supabase_realtime ADD TABLE liabilities;
ALTER PUBLICATION supabase_realtime ADD TABLE loans;
