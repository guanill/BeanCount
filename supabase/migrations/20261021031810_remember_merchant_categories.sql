CREATE TABLE public.merchant_category_rules (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  merchant_key text NOT NULL CHECK (length(merchant_key) BETWEEN 1 AND 500),
  category text NOT NULL CHECK (category IN (
    'income', 'transfer_in', 'transfer_out', 'food_and_drink', 'groceries',
    'shopping', 'subscriptions', 'transportation', 'entertainment',
    'rent_and_utilities', 'medical', 'personal_care', 'travel',
    'loan_payments', 'home_improvement', 'education', 'pets', 'donations',
    'general_services', 'government', 'bank_fees', 'other'
  )),
  transaction_type public.transaction_type NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, merchant_key)
);

ALTER TABLE public.merchant_category_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own merchant category rules"
  ON public.merchant_category_rules
  FOR ALL
  TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

REVOKE ALL ON TABLE public.merchant_category_rules FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.merchant_category_rules TO authenticated;
GRANT ALL ON TABLE public.merchant_category_rules TO service_role;