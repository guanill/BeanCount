ALTER TABLE loans ADD COLUMN IF NOT EXISTS payment_day integer
  CHECK (payment_day IS NULL OR (payment_day BETWEEN 1 AND 31));
