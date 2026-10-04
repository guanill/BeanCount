-- Crypto positions share this table with stock positions, and 6 decimal places
-- can't represent them: bitcoin is conventionally 8 dp, so 0.00000001 BTC rounded
-- to 0.000000 and then tripped CHECK (shares > 0), making the insert fail outright.
ALTER TABLE stock_holdings
  ALTER COLUMN shares TYPE numeric(28,8);
