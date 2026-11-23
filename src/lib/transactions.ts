export interface SplitCheckableTransaction {
  is_ignored?: boolean | null;
  notes?: string | null;
}

export interface AmountCheckableTransaction {
  amount: number;
  is_ignored?: boolean | null;
}

export interface ExpenseCheckableTransaction extends AmountCheckableTransaction {
  transaction_type: string;
}

export interface SplitDeletableTransaction {
  is_manual?: boolean | null;
  import_fingerprint?: string | null;
  plaid_transaction_id?: string | null;
  teller_transaction_id?: string | null;
}

/**
 * Returns true for original imported transactions that were replaced by a split.
 * These remain ignored in the database solely to prevent duplicate CSV/bank re-imports,
 * and should be hidden from the transaction list UI.
 */
export function isSplitOriginal(tx: SplitCheckableTransaction): boolean {
  return Boolean(tx.is_ignored && (tx.notes ?? "").includes("[split]"));
}

/** Filters out hidden `[split]` original rows while keeping manually ignored rows visible. */
export function filterVisibleTransactions<T extends SplitCheckableTransaction>(
  transactions: T[],
): T[] {
  return transactions.filter((tx) => !isSplitOriginal(tx));
}

/** Sums absolute amounts while excluding ignored transactions. */
export function sumActiveAmount<T extends AmountCheckableTransaction>(
  transactions: T[],
): number {
  return transactions.reduce(
    (sum, tx) => (tx.is_ignored ? sum : sum + Math.abs(tx.amount)),
    0,
  );
}

/** Sums absolute expense amounts while excluding ignored transactions. */
export function sumActiveExpenses<T extends ExpenseCheckableTransaction>(
  transactions: T[],
): number {
  return transactions.reduce(
    (sum, tx) =>
      tx.transaction_type === "expense" && !tx.is_ignored
        ? sum + Math.abs(tx.amount)
        : sum,
    0,
  );
}

/** Builds clear default labels for a two-way transaction split. */
export function defaultSplitNames(originalName: string): {
  yourPart: string;
  otherPart: string;
} {
  const base = originalName.trim() || "Transaction";
  return {
    yourPart: `${base} (your part)`,
    otherPart: `${base} (other part)`,
  };
}

/**
 * Purely manual transactions can be deleted when split; imported/synced rows
 * stay ignored with `[split]` so re-importing the same CSV or bank feed won't duplicate them.
 */
export function canDeleteSplitOriginal(tx: SplitDeletableTransaction): boolean {
  return Boolean(
    tx.is_manual &&
      !tx.import_fingerprint &&
      !tx.plaid_transaction_id &&
      !tx.teller_transaction_id,
  );
}
