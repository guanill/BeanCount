-- Drop the partial unique index and create a regular one so upsert ON CONFLICT works
DROP INDEX IF EXISTS idx_teller_transaction_id;
CREATE UNIQUE INDEX idx_teller_transaction_id ON transactions(teller_transaction_id);
