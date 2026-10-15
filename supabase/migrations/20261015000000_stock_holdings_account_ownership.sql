-- Ensure a holding can only reference an account owned by the same user.
-- A composite foreign key enforces this at the database boundary, including
-- writes made outside the application.

ALTER TABLE accounts
  ADD CONSTRAINT accounts_user_id_id_key UNIQUE (user_id, id);

ALTER TABLE stock_holdings
  DROP CONSTRAINT IF EXISTS stock_holdings_account_id_fkey;

ALTER TABLE stock_holdings
  ADD CONSTRAINT stock_holdings_user_account_fkey
  FOREIGN KEY (user_id, account_id)
  REFERENCES accounts (user_id, id)
  ON DELETE CASCADE;

ALTER PUBLICATION supabase_realtime ADD TABLE stock_holdings;
ALTER PUBLICATION supabase_realtime ADD TABLE planner_configs;
