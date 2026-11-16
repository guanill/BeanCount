export interface FlowTransaction {
  amount: number;
  name: string;
  merchant_name: string | null;
  category: string;
  transaction_type: "income" | "expense" | "transfer";
  is_ignored: boolean;
}

export interface FlowItem {
  key: string;
  label: string;
  amount: number;
}

export function buildSpendingFlow(transactions: FlowTransaction[]) {
  const income = new Map<string, FlowItem>();
  const expenses = new Map<string, FlowItem>();
  for (const transaction of transactions) {
    if (transaction.is_ignored || transaction.transaction_type === "transfer") continue;
    const amount = Math.abs(Number(transaction.amount));
    if (!Number.isFinite(amount) || amount === 0) continue;

    if (transaction.transaction_type === "income") {
      const label = (transaction.merchant_name || transaction.name).trim() || "Income";
      const key = label.toLocaleLowerCase();
      const previous = income.get(key);
      income.set(key, { key, label: previous?.label ?? label, amount: (previous?.amount ?? 0) + amount });
    } else {
      const key = transaction.category;
      const previous = expenses.get(key);
      expenses.set(key, { key, label: key, amount: (previous?.amount ?? 0) + amount });
    }
  }
  const sources = [...income.values()].sort((a, b) => b.amount - a.amount);
  const categories = [...expenses.values()].sort((a, b) => b.amount - a.amount);
  const totalIncome = sources.reduce((sum, item) => sum + item.amount, 0);
  const totalExpenses = categories.reduce((sum, item) => sum + item.amount, 0);
  return {
    sources,
    categories,
    totalIncome,
    totalExpenses,
    remainder: Math.max(0, totalIncome - totalExpenses),
    shortfall: Math.max(0, totalExpenses - totalIncome),
  };
}
