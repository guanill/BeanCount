-- ============================================================
-- Planner config: persists planner settings per user
-- ============================================================

CREATE TABLE planner_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  config jsonb NOT NULL DEFAULT '{}',
  paid_loan_ids jsonb NOT NULL DEFAULT '[]',
  paid_loan_month text NOT NULL DEFAULT '',
  dismissed_suggestions jsonb NOT NULL DEFAULT '[]',
  tax_filing_status text NOT NULL DEFAULT 'single',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_planner_configs_user_id ON planner_configs(user_id);

-- RLS
ALTER TABLE planner_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own rows" ON planner_configs
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own rows" ON planner_configs
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own rows" ON planner_configs
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own rows" ON planner_configs
  FOR DELETE USING (auth.uid() = user_id);
