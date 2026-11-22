export const VALID_CATEGORIES = new Set([
  "income",
  "transfer_in",
  "transfer_out",
  "food_and_drink",
  "groceries",
  "shopping",
  "subscriptions",
  "transportation",
  "entertainment",
  "rent_and_utilities",
  "medical",
  "personal_care",
  "travel",
  "loan_payments",
  "home_improvement",
  "education",
  "pets",
  "donations",
  "general_services",
  "government",
  "bank_fees",
  "other",
]);

export const VALID_TRANSACTION_TYPES = new Set(["income", "expense", "transfer"]);

export interface NamedEntity {
  id: string;
  name: string;
}

export type MatchResult<T extends NamedEntity> =
  | { ok: true; match: T }
  | { ok: false; error: string; candidates?: string[] };

/**
 * Resolve an account or credit card by exact ID, exact case-insensitive name,
 * or unambiguous substring match. Never guesses when multiple items match.
 */
export function resolveNamedEntity<T extends NamedEntity>(
  items: T[],
  id: string | undefined,
  name: string | undefined,
  label: string
): MatchResult<T> {
  if (id) {
    const byId = items.find((item) => item.id === id);
    if (byId) return { ok: true, match: byId };
    return { ok: false, error: `No ${label} found with id "${id}".` };
  }

  const query = name?.trim().toLowerCase();
  if (!query) {
    return { ok: false, error: `Provide either ${label}_id or ${label}_name.` };
  }

  const exact = items.filter((item) => item.name.trim().toLowerCase() === query);
  if (exact.length === 1) return { ok: true, match: exact[0] };
  if (exact.length > 1) {
    return {
      ok: false,
      error: `Multiple ${label}s match "${name}". Please specify by id.`,
      candidates: exact.map((i) => `${i.name} (${i.id})`),
    };
  }

  const partial = items.filter((item) => item.name.toLowerCase().includes(query));
  if (partial.length === 1) return { ok: true, match: partial[0] };
  if (partial.length > 1) {
    return {
      ok: false,
      error: `Ambiguous ${label} name "${name}". Matches: ${partial.map((i) => i.name).join(", ")}.`,
      candidates: partial.map((i) => `${i.name} (${i.id})`),
    };
  }

  return {
    ok: false,
    error: `No ${label} found matching "${name}". Available: ${items.map((i) => i.name).join(", ") || "none"}.`,
  };
}

/** Constant-time string comparison for bearer tokens. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export interface SimpleTransaction {
  amount: number;
  category: string;
  transaction_type: string;
  is_ignored?: boolean;
}

/** Summarize income, expenses, and per-category totals for a list of transactions. */
export function summarizeTransactions(txns: SimpleTransaction[]) {
  let income = 0;
  let expenses = 0;
  let transfers = 0;
  const byCategory: Record<string, number> = {};

  for (const t of txns) {
    if (t.is_ignored) continue;
    const amt = Number(t.amount);
    if (!Number.isFinite(amt)) continue;

    if (t.transaction_type === "transfer") {
      transfers += Math.abs(amt);
      continue;
    }
    if (t.transaction_type === "income") {
      income += Math.abs(amt);
    } else {
      const spend = Math.abs(amt);
      expenses += spend;
      const cat = t.category || "other";
      byCategory[cat] = Number(((byCategory[cat] ?? 0) + spend).toFixed(2));
    }
  }

  const categories = Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([category, total]) => ({ category, total }));

  return {
    income: Number(income.toFixed(2)),
    expenses: Number(expenses.toFixed(2)),
    net: Number((income - expenses).toFixed(2)),
    transfers: Number(transfers.toFixed(2)),
    categories,
  };
}
