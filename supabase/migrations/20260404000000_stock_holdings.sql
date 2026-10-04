-- ============================================================
-- Stock holdings: individual positions (ticker + shares) linked to an account
-- ============================================================

CREATE TABLE stock_holdings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ticker text NOT NULL,
  shares numeric(18,6) NOT NULL CHECK (shares > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, ticker)
);

CREATE INDEX idx_stock_holdings_user_id ON stock_holdings(user_id);
CREATE INDEX idx_stock_holdings_account_id ON stock_holdings(account_id);

ALTER TABLE stock_holdings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own rows" ON stock_holdings
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own rows" ON stock_holdings
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own rows" ON stock_holdings
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own rows" ON stock_holdings
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON stock_holdings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
