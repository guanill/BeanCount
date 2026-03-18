-- Add Plaid integration columns to credit_cards table
ALTER TABLE credit_cards
  ADD COLUMN IF NOT EXISTS plaid_account_id text,
  ADD COLUMN IF NOT EXISTS plaid_item_id text,
  ADD COLUMN IF NOT EXISTS plaid_institution_name text,
  ADD COLUMN IF NOT EXISTS plaid_last_synced timestamptz;

-- Index for fast lookups by plaid_account_id
CREATE INDEX IF NOT EXISTS idx_credit_cards_plaid_account_id
  ON credit_cards (plaid_account_id)
  WHERE plaid_account_id IS NOT NULL;
