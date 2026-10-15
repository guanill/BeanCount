-- Store one daily net-worth snapshot per user for trend history.
CREATE TABLE net_worth_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  snapshot_date date NOT NULL DEFAULT CURRENT_DATE,
  net_worth numeric(18, 2) NOT NULL,
  assets_total numeric(18, 2) NOT NULL,
  stock_total numeric(18, 2) NOT NULL DEFAULT 0,
  crypto_total numeric(18, 2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, snapshot_date)
);

CREATE INDEX idx_net_worth_snapshots_user_date
  ON net_worth_snapshots(user_id, snapshot_date DESC);

ALTER TABLE net_worth_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can select own net worth snapshots"
  ON net_worth_snapshots FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own net worth snapshots"
  ON net_worth_snapshots FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own net worth snapshots"
  ON net_worth_snapshots FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own net worth snapshots"
  ON net_worth_snapshots FOR DELETE USING (auth.uid() = user_id);
