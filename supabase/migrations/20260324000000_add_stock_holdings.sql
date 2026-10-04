-- Stock positions are owned through their associated stock account.
CREATE TABLE stock_holdings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ticker text NOT NULL CHECK (ticker ~ '^[A-Z0-9.-]{1,12}$'),
  shares numeric NOT NULL CHECK (shares > 0),
  latest_price numeric CHECK (latest_price IS NULL OR latest_price > 0),
  previous_close numeric CHECK (previous_close IS NULL OR previous_close > 0),
  quote_source text,
  quote_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, ticker)
);

ALTER TABLE stock_holdings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own stock holdings" ON stock_holdings
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM accounts
      WHERE accounts.id = stock_holdings.account_id
        AND accounts.user_id = auth.uid()
        AND accounts.type = 'stock'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM accounts
      WHERE accounts.id = stock_holdings.account_id
        AND accounts.user_id = auth.uid()
        AND accounts.type = 'stock'
    )
  );

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON stock_holdings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
