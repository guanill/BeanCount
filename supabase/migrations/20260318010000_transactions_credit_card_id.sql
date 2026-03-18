-- Add credit_card_id to transactions for tracking which card a transaction came from
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS credit_card_id uuid REFERENCES credit_cards(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_credit_card_id
  ON transactions (credit_card_id)
  WHERE credit_card_id IS NOT NULL;
