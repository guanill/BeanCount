ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS import_fingerprint text,
  ADD COLUMN IF NOT EXISTS source_name text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_user_import_fingerprint
  ON transactions (user_id, import_fingerprint);
