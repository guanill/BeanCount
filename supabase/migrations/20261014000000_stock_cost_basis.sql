-- Preserve what was paid for a position so the overview can show realized
-- market gain/loss without changing the quote service.
ALTER TABLE stock_holdings
  ADD COLUMN IF NOT EXISTS cost_basis numeric(18,2);
