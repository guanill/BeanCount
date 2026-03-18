import { SupabaseClient } from "@supabase/supabase-js";
import type {
  Account,
  CreditCard,
  DebtOwed,
  Transaction,
  Loan,
  Liability,
  DashboardData,
  TransactionSummary,
} from "@/lib/types";
import { CATEGORIES, getCategoryMeta, guessCategory } from "@/lib/categories";

// ─── Dashboard ──────────────────────────────────────────────────────────────

export async function getDashboardData(
  supabase: SupabaseClient
): Promise<DashboardData> {
  const [
    { data: bankAccounts },
    { data: stockAccounts },
    { data: cryptoAccounts },
    { data: creditCards },
    { data: debtsOwed },
    { data: liabilities },
  ] = await Promise.all([
    supabase
      .from("accounts")
      .select("*")
      .eq("type", "bank")
      .order("balance", { ascending: false }),
    supabase
      .from("accounts")
      .select("*")
      .eq("type", "stock")
      .order("balance", { ascending: false }),
    supabase
      .from("accounts")
      .select("*")
      .eq("type", "crypto")
      .order("balance", { ascending: false }),
    supabase
      .from("credit_cards")
      .select("*")
      .order("balance_owed", { ascending: false }),
    supabase
      .from("debts_owed")
      .select("*")
      .neq("status", "paid")
      .order("amount", { ascending: false }),
    supabase
      .from("liabilities")
      .select("*")
      .order("amount", { ascending: false }),
  ]);

  const bank = (bankAccounts ?? []) as Account[];
  const stock = (stockAccounts ?? []) as Account[];
  const crypto = (cryptoAccounts ?? []) as Account[];
  const cards = (creditCards ?? []) as CreditCard[];
  const debts = (debtsOwed ?? []) as DebtOwed[];
  const liabs = (liabilities ?? []) as Liability[];

  const bankTotal = bank.reduce((s, a) => s + Number(a.balance), 0);
  const stockTotal = stock.reduce((s, a) => s + Number(a.balance), 0);
  const cryptoTotal = crypto.reduce((s, a) => s + Number(a.balance), 0);
  const assetsTotal = bankTotal + stockTotal + cryptoTotal;
  const debtsOwedTotal = debts.reduce((s, d) => s + Number(d.amount), 0);
  const creditCardDebt = cards.reduce((s, c) => s + Math.max(0, Number(c.balance_owed)), 0);
  const liabilitiesTotal = liabs.reduce((s, l) => s + Number(l.amount), 0);
  const pointsValue = cards.reduce(
    (s, c) => s + (Number(c.points_balance) * Number(c.points_value_cents)) / 100,
    0
  );
  const netWorth =
    assetsTotal + debtsOwedTotal + pointsValue - creditCardDebt - liabilitiesTotal;

  return {
    accounts: { bank, stock, crypto },
    creditCards: cards,
    debtsOwed: debts,
    liabilities: liabs,
    totals: {
      bankTotal,
      stockTotal,
      cryptoTotal,
      assetsTotal,
      debtsOwedTotal,
      creditCardDebt,
      liabilitiesTotal,
      pointsValue,
      netWorth,
    },
  };
}

// ─── Accounts ───────────────────────────────────────────────────────────────

export async function getAccounts(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("accounts")
    .select("*")
    .order("type")
    .order("balance", { ascending: false });
  if (error) throw error;
  return data as Account[];
}

export async function createAccount(
  supabase: SupabaseClient,
  account: {
    name: string;
    type: string;
    balance?: number;
    currency?: string;
    icon?: string;
    color?: string;
  }
) {
  const { data, error } = await supabase
    .from("accounts")
    .insert({
      name: account.name,
      type: account.type,
      balance: account.balance ?? 0,
      currency: account.currency ?? "USD",
      icon: account.icon ?? null,
      color: account.color ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Account;
}

export async function updateAccount(
  supabase: SupabaseClient,
  id: string,
  updates: Partial<{
    name: string;
    type: string;
    balance: number;
    currency: string;
    icon: string;
    color: string;
  }>
) {
  const { data, error } = await supabase
    .from("accounts")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as Account;
}

export async function deleteAccount(supabase: SupabaseClient, id: string) {
  const { error } = await supabase.from("accounts").delete().eq("id", id);
  if (error) throw error;
}

// ─── Credit Cards ───────────────────────────────────────────────────────────

export async function getCreditCards(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("credit_cards")
    .select("*")
    .order("balance_owed", { ascending: false });
  if (error) throw error;
  return data as CreditCard[];
}

export async function createCreditCard(
  supabase: SupabaseClient,
  card: {
    name: string;
    balance_owed?: number;
    credit_limit?: number;
    points_balance?: number;
    points_value_cents?: number;
    due_date?: string;
    min_payment?: number;
    color?: string;
  }
) {
  const { data, error } = await supabase
    .from("credit_cards")
    .insert({
      name: card.name,
      balance_owed: card.balance_owed ?? 0,
      credit_limit: card.credit_limit ?? 0,
      points_balance: card.points_balance ?? 0,
      points_value_cents: card.points_value_cents ?? 1,
      due_date: card.due_date ?? null,
      min_payment: card.min_payment ?? 0,
      color: card.color ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as CreditCard;
}

export async function updateCreditCard(
  supabase: SupabaseClient,
  id: string,
  updates: Partial<CreditCard>
) {
  const { data, error } = await supabase
    .from("credit_cards")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as CreditCard;
}

export async function deleteCreditCard(supabase: SupabaseClient, id: string) {
  const { error } = await supabase.from("credit_cards").delete().eq("id", id);
  if (error) throw error;
}

// ─── Debts Owed ─────────────────────────────────────────────────────────────

export async function getDebts(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("debts_owed")
    .select("*")
    .order("status")
    .order("amount", { ascending: false });
  if (error) throw error;
  return data as DebtOwed[];
}

export async function createDebt(
  supabase: SupabaseClient,
  debt: { person_name: string; amount: number; reason?: string; due_date?: string }
) {
  const { data, error } = await supabase
    .from("debts_owed")
    .insert({
      person_name: debt.person_name,
      amount: debt.amount,
      reason: debt.reason ?? null,
      due_date: debt.due_date ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as DebtOwed;
}

export async function updateDebt(
  supabase: SupabaseClient,
  id: string,
  updates: Partial<DebtOwed>
) {
  const { data, error } = await supabase
    .from("debts_owed")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as DebtOwed;
}

export async function deleteDebt(supabase: SupabaseClient, id: string) {
  const { error } = await supabase.from("debts_owed").delete().eq("id", id);
  if (error) throw error;
}

// ─── Liabilities ────────────────────────────────────────────────────────────

export async function getLiabilities(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("liabilities")
    .select("*")
    .order("amount", { ascending: false });
  if (error) throw error;
  return data as Liability[];
}

export async function createLiability(
  supabase: SupabaseClient,
  liability: {
    name: string;
    amount: number;
    category?: string;
    notes?: string;
    due_date?: string;
  }
) {
  const { data, error } = await supabase
    .from("liabilities")
    .insert({
      name: liability.name,
      amount: liability.amount,
      category: liability.category ?? "other",
      notes: liability.notes ?? null,
      due_date: liability.due_date ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Liability;
}

export async function updateLiability(
  supabase: SupabaseClient,
  id: string,
  updates: Partial<Liability>
) {
  const { data, error } = await supabase
    .from("liabilities")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as Liability;
}

export async function deleteLiability(supabase: SupabaseClient, id: string) {
  const { error } = await supabase.from("liabilities").delete().eq("id", id);
  if (error) throw error;
}

// ─── Loans ──────────────────────────────────────────────────────────────────

export async function getLoans(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("loans")
    .select("*")
    .order("balance", { ascending: false });
  if (error) throw error;
  return data as Loan[];
}

export async function createLoan(
  supabase: SupabaseClient,
  loan: {
    name: string;
    type?: string;
    balance: number;
    original_amount?: number;
    interest_rate: number;
    monthly_payment: number;
    notes?: string;
    deferral_months?: number;
    deferral_type?: string;
  }
) {
  const { data, error } = await supabase
    .from("loans")
    .insert({
      name: loan.name,
      type: loan.type ?? "personal",
      balance: loan.balance,
      original_amount: loan.original_amount ?? null,
      interest_rate: loan.interest_rate,
      monthly_payment: loan.monthly_payment,
      notes: loan.notes ?? null,
      deferral_months: loan.deferral_months ?? 0,
      deferral_type: loan.deferral_type ?? "unsubsidized",
    })
    .select()
    .single();
  if (error) throw error;
  return data as Loan;
}

export async function updateLoan(
  supabase: SupabaseClient,
  id: string,
  updates: Partial<Loan>
) {
  const { data, error } = await supabase
    .from("loans")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as Loan;
}

export async function deleteLoan(supabase: SupabaseClient, id: string) {
  const { error } = await supabase.from("loans").delete().eq("id", id);
  if (error) throw error;
}

// ─── Transactions ───────────────────────────────────────────────────────────

export async function getTransactions(
  supabase: SupabaseClient,
  filters: {
    month?: number;
    year?: number;
    category?: string;
    type?: string;
    q?: string;
  } = {}
): Promise<{ transactions: Transaction[]; summary: TransactionSummary }> {
  let query = supabase
    .from("transactions")
    .select("*")
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(500);

  // Apply date filter
  if (filters.month && filters.year) {
    const monthStr = String(filters.month).padStart(2, "0");
    const startDate = `${filters.year}-${monthStr}-01`;
    const endDate =
      filters.month === 12
        ? `${filters.year + 1}-01-01`
        : `${filters.year}-${String(filters.month + 1).padStart(2, "0")}-01`;
    query = query.gte("date", startDate).lt("date", endDate);
  } else if (filters.year) {
    query = query
      .gte("date", `${filters.year}-01-01`)
      .lt("date", `${filters.year + 1}-01-01`);
  }

  if (filters.category) {
    query = query.eq("category", filters.category);
  }
  if (filters.type) {
    query = query.eq("transaction_type", filters.type);
  }
  if (filters.q) {
    query = query.or(
      `name.ilike.%${filters.q}%,merchant_name.ilike.%${filters.q}%`
    );
  }

  const { data, error } = await query;
  if (error) throw error;

  // Map account + credit card names from separate lookups
  const accountIds = [...new Set((data ?? []).map((r: any) => r.account_id).filter(Boolean))];
  const creditCardIds = [...new Set((data ?? []).map((r: any) => r.credit_card_id).filter(Boolean))];
  let sourceMap = new Map<string, string>();
  if (accountIds.length > 0) {
    const { data: accts } = await supabase.from("accounts").select("id, name").in("id", accountIds);
    for (const a of accts ?? []) sourceMap.set(a.id, a.name);
  }
  if (creditCardIds.length > 0) {
    const { data: cards } = await supabase.from("credit_cards").select("id, name").in("id", creditCardIds);
    for (const c of cards ?? []) sourceMap.set(c.id, c.name);
  }

  const transactions: Transaction[] = (data ?? []).map((row: any) => ({
    ...row,
    account_name: sourceMap.get(row.account_id) ?? sourceMap.get(row.credit_card_id) ?? null,
  }));

  // Calculate summary (excluding ignored)
  const active = transactions.filter((t) => !t.is_ignored);
  const totalIncome = active
    .filter((t) => t.transaction_type === "income")
    .reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
  const totalExpenses = active
    .filter((t) => t.transaction_type === "expense")
    .reduce((s, t) => s + Math.abs(Number(t.amount)), 0);

  // Group by category
  const catMap = new Map<string, { amount: number; count: number }>();
  for (const t of active) {
    if (t.transaction_type !== "expense") continue;
    const prev = catMap.get(t.category) ?? { amount: 0, count: 0 };
    catMap.set(t.category, {
      amount: prev.amount + Math.abs(Number(t.amount)),
      count: prev.count + 1,
    });
  }

  const byCategory = Array.from(catMap.entries())
    .map(([category, { amount, count }]) => {
      const meta = getCategoryMeta(category);
      return {
        category,
        label: meta.label,
        color: meta.color,
        emoji: meta.emoji,
        amount,
        count,
        type: meta.type,
      };
    })
    .sort((a, b) => b.amount - a.amount);

  return {
    transactions,
    summary: {
      totalIncome,
      totalExpenses,
      net: totalIncome - totalExpenses,
      byCategory,
    },
  };
}

export async function createTransaction(
  supabase: SupabaseClient,
  tx: {
    account_id?: string;
    amount: number;
    date?: string;
    name?: string;
    merchant_name?: string;
    category?: string;
    transaction_type?: string;
    notes?: string;
  }
) {
  const txName = tx.name || tx.merchant_name || "Manual entry";
  const amt = tx.amount;
  let category = tx.category;
  let txType = tx.transaction_type;

  if (!category || !txType) {
    const guess = guessCategory(txName, amt, tx.merchant_name);
    category = category || guess.category;
    txType = txType || guess.type;
  }

  const { data, error } = await supabase
    .from("transactions")
    .insert({
      account_id: tx.account_id ?? null,
      amount: amt,
      date: tx.date ?? new Date().toISOString().slice(0, 10),
      name: txName,
      merchant_name: tx.merchant_name ?? null,
      category,
      transaction_type: txType,
      is_manual: true,
      notes: tx.notes ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Transaction;
}

export async function updateTransaction(
  supabase: SupabaseClient,
  id: string,
  updates: Partial<{
    name: string;
    category: string;
    transaction_type: string;
    amount: number;
    notes: string;
    is_ignored: boolean;
  }>
) {
  const { data, error } = await supabase
    .from("transactions")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as Transaction;
}

export async function deleteTransaction(supabase: SupabaseClient, id: string) {
  // Only allow deleting manual transactions
  const { error } = await supabase
    .from("transactions")
    .delete()
    .eq("id", id)
    .eq("is_manual", true);
  if (error) throw error;
}

export async function splitTransaction(
  supabase: SupabaseClient,
  id: string,
  a: { name: string; amount: number; category: string; transaction_type: string },
  b: { name: string; amount: number; category: string; transaction_type: string }
) {
  // Get original transaction
  const { data: original, error: fetchError } = await supabase
    .from("transactions")
    .select("*")
    .eq("id", id)
    .single();
  if (fetchError) throw fetchError;

  // Mark original as ignored
  const notes = original.notes
    ? `${original.notes} [split]`
    : "[split]";
  await supabase
    .from("transactions")
    .update({ is_ignored: true, notes })
    .eq("id", id);

  // Create two new transactions
  const base = {
    account_id: original.account_id,
    date: original.date,
    is_manual: true,
    merchant_name: original.merchant_name,
  };

  const { error: insertError } = await supabase.from("transactions").insert([
    { ...base, name: a.name, amount: a.amount, category: a.category, transaction_type: a.transaction_type },
    { ...base, name: b.name, amount: b.amount, category: b.category, transaction_type: b.transaction_type },
  ]);
  if (insertError) throw insertError;
}

// ─── Planner Config ──────────────────────────────────────────────────────────

export interface PlannerRow {
  config: Record<string, unknown>;
  paid_loan_ids: string[];
  paid_loan_month: string;
  dismissed_suggestions: string[];
  tax_filing_status: string;
}

export async function getPlannerConfig(supabase: SupabaseClient): Promise<PlannerRow | null> {
  const { data } = await supabase
    .from("planner_configs")
    .select("config, paid_loan_ids, paid_loan_month, dismissed_suggestions, tax_filing_status")
    .maybeSingle();
  return data as PlannerRow | null;
}

export async function upsertPlannerConfig(
  supabase: SupabaseClient,
  row: Partial<PlannerRow>,
) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase
    .from("planner_configs")
    .upsert({ user_id: user.id, ...row }, { onConflict: "user_id" });
  if (error) throw error;
}
