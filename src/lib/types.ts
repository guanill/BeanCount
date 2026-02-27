export type AccountType = "bank" | "stock" | "crypto";

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  balance: number;
  currency: string;
  icon: string | null;
  color: string | null;
  // Plaid (legacy)
  plaid_account_id: string | null;
  plaid_institution_name: string | null;
  plaid_last_synced: string | null;
  // Teller
  teller_account_id: string | null;
  teller_institution_name: string | null;
  teller_last_synced: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreditCard {
  id: string;
  name: string;
  balance_owed: number;
  credit_limit: number;
  points_balance: number;
  points_value_cents: number;
  due_date: string | null;
  min_payment: number;
  color: string | null;
  teller_account_id: string | null;
  teller_institution_name: string | null;
  teller_last_synced: string | null;
  created_at: string;
  updated_at: string;
}

export interface DebtOwed {
  id: string;
  person_name: string;
  amount: number;
  reason: string | null;
  due_date: string | null;
  status: "pending" | "partial" | "paid";
  created_at: string;
  updated_at: string;
}

export interface Transaction {
  id: string;
  account_id: string | null;
  plaid_transaction_id: string | null;
  teller_transaction_id: string | null;
  amount: number;           // positive = expense, negative = income
  date: string;             // YYYY-MM-DD
  name: string;
  merchant_name: string | null;
  category: string;
  subcategory: string | null;
  transaction_type: "income" | "expense" | "transfer";
  is_manual: number;        // 0 or 1
  notes: string | null;
  created_at: string;
}

export interface Loan {
  id: string;
  name: string;
  type: string;
  balance: number;
  original_amount: number | null;
  interest_rate: number;
  monthly_payment: number;
  notes: string | null;
  deferral_months: number;          // 0 = not deferred
  deferral_type: "subsidized" | "unsubsidized";
  created_at: string;
  updated_at: string;
}

export interface Liability {
  id: string;
  name: string;
  amount: number;
  category: string;
  notes: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface TransactionSummary {
  totalIncome: number;
  totalExpenses: number;
  net: number;
  byCategory: Array<{
    category: string;
    label: string;
    color: string;
    emoji: string;
    amount: number;
    count: number;
    type: "income" | "expense" | "transfer";
  }>;
}

export interface DashboardData {
  accounts: {
    bank: Account[];
    stock: Account[];
    crypto: Account[];
  };
  creditCards: CreditCard[];
  debtsOwed: DebtOwed[];
  liabilities: Liability[];
  totals: {
    bankTotal: number;
    stockTotal: number;
    cryptoTotal: number;
    assetsTotal: number;
    debtsOwedTotal: number;
    creditCardDebt: number;
    liabilitiesTotal: number;
    pointsValue: number;
    netWorth: number;
  };
}
