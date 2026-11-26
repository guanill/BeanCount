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

/** Returns the default transaction_type for a BeanCount category slug. */
export function defaultTransactionTypeForCategory(category: string): "income" | "expense" | "transfer" {
  if (category === "income") return "income";
  if (category === "transfer_in" || category === "transfer_out") return "transfer";
  return "expense";
}

/** Normalizes a merchant name for matching/saving in merchant_category_rules. */
export function normalizeMerchantKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const key = value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
  return key.length > 0 && key.length <= 500 ? key : null;
}

/** Matches BeanCount's Plaid-style signed amount convention (income negative, outflow positive). */
export function toSignedAmount(amount: number, transactionType: string): number {
  return transactionType === "income" ? -Math.abs(amount) : Math.abs(amount);
}

// ── Split Transactions ───────────────────────────────────────────────────────

export interface SplitCheckableTransaction {
  is_ignored?: boolean | null;
  notes?: string | null;
}

export interface SplitDeletableTransaction {
  is_manual?: boolean | null;
  import_fingerprint?: string | null;
  plaid_transaction_id?: string | null;
  teller_transaction_id?: string | null;
}

/** Returns true for original imported/synced rows replaced by a split. */
export function isSplitOriginal(tx: SplitCheckableTransaction): boolean {
  return Boolean(tx.is_ignored && (tx.notes ?? "").includes("[split]"));
}

/** Purely manual rows can be deleted on split; imported/synced rows stay ignored with [split]. */
export function canDeleteSplitOriginal(tx: SplitDeletableTransaction): boolean {
  return Boolean(
    tx.is_manual &&
      !tx.import_fingerprint &&
      !tx.plaid_transaction_id &&
      !tx.teller_transaction_id
  );
}

/** Builds default labels for a two-way transaction split. */
export function defaultSplitNames(originalName: string): { yourPart: string; otherPart: string } {
  const base = originalName.trim() || "Transaction";
  return {
    yourPart: `${base} (your part)`,
    otherPart: `${base} (other part)`,
  };
}

/** Appends `[split]` to notes once without duplicating an existing tag. */
export function appendSplitTag(existingNotes: string | null | undefined): string {
  const trimmed = (existingNotes ?? "").trim();
  if (trimmed.includes("[split]")) return trimmed;
  return trimmed ? `${trimmed} [split]` : "[split]";
}

// ── Refund Linking ───────────────────────────────────────────────────────────

export interface RefundLink {
  role: "original" | "refund";
  partnerId: string;
  partnerDate: string;
  partnerName: string;
}

const REFUND_TAG_RE = /\[refund:(original|refund):([^:\]]+):([^:\]]+):([^\]]+)\]/;

function sanitizeRefundLabel(name: string): string {
  return name.replace(/[\]:]/g, " ").replace(/\s+/g, " ").trim() || "Transaction";
}

/** Parses a `[refund:...]` link tag from a transaction's notes field. */
export function parseRefundLink(notes?: string | null): RefundLink | null {
  if (!notes) return null;
  const match = notes.match(REFUND_TAG_RE);
  if (!match) return null;
  return {
    role: match[1] as "original" | "refund",
    partnerId: match[2],
    partnerDate: match[3],
    partnerName: match[4].trim(),
  };
}

/** Strips any internal `[refund:...]` tag from notes. */
export function stripRefundTag(notes?: string | null): string {
  if (!notes) return "";
  return notes.replace(REFUND_TAG_RE, "").replace(/\s{2,}/g, " ").trim();
}

/** Attaches (or replaces) a `[refund:...]` tag while preserving any user notes. */
export function attachRefundTag(
  existingNotes: string | null | undefined,
  link: RefundLink
): string {
  const clean = stripRefundTag(existingNotes);
  const tag = `[refund:${link.role}:${link.partnerId}:${link.partnerDate}:${sanitizeRefundLabel(link.partnerName)}]`;
  return clean ? `${clean} ${tag}` : tag;
}

/** Removes any `[refund:...]` tag from notes, returning null if nothing remains. */
export function removeRefundTag(notes?: string | null): string | null {
  const clean = stripRefundTag(notes);
  return clean ? clean : null;
}

export interface RefundCandidate {
  id: string;
  name: string;
  merchant_name?: string | null;
  amount: number;
  date: string;
  transaction_type: string;
  is_ignored?: boolean | null;
  notes?: string | null;
}

function tokenizeName(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter((w) => w.length >= 3)
  );
}

function daysBetween(dateA: string, dateB: string): number {
  const msA = Date.parse(`${dateA.slice(0, 10)}T00:00:00Z`);
  const msB = Date.parse(`${dateB.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(msA) || Number.isNaN(msB)) return 999;
  return Math.abs(msA - msB) / 86_400_000;
}

/** Ranks candidate transactions most likely to be the refund/original partner of `target`. */
export function rankRefundCandidates<T extends RefundCandidate>(
  target: RefundCandidate,
  candidates: T[]
): T[] {
  const targetAmt = Math.abs(target.amount);
  const targetTokens = tokenizeName(target.merchant_name || target.name);

  return candidates
    .filter((c) => c.id !== target.id && !c.is_ignored && !isSplitOriginal(c))
    .map((c) => {
      let score = 0;
      const amt = Math.abs(c.amount);

      if (Math.abs(amt - targetAmt) < 0.01) {
        score += 100;
      } else if (
        (target.transaction_type === "expense" && amt < targetAmt) ||
        (target.transaction_type !== "expense" && amt > targetAmt)
      ) {
        score += 30;
      }

      if (c.transaction_type !== target.transaction_type) {
        score += 50;
      }

      const candTokens = tokenizeName(c.merchant_name || c.name);
      let shared = 0;
      for (const tok of targetTokens) {
        if (candTokens.has(tok)) shared += 1;
      }
      if (shared > 0) score += 40 + Math.min(shared, 3) * 5;

      const gap = daysBetween(target.date, c.date);
      if (gap <= 14) score += 35;
      else if (gap <= 45) score += 20;
      else if (gap <= 90) score += 10;

      return { c, score };
    })
    .sort((a, b) => b.score - a.score || b.c.date.localeCompare(a.c.date))
    .map((entry) => entry.c);
}

/** Determines which transaction in a linked pair is the original purchase and which is the refund. */
export function classifyRefundPair<
  T extends { id: string; amount: number; date: string; transaction_type: string }
>(txA: T, txB: T): { original: T; refund: T } {
  if (txA.transaction_type === "expense" && txB.transaction_type !== "expense") {
    return { original: txA, refund: txB };
  }
  if (txB.transaction_type === "expense" && txA.transaction_type !== "expense") {
    return { original: txB, refund: txA };
  }
  if (Math.abs(txA.amount) !== Math.abs(txB.amount)) {
    return Math.abs(txA.amount) > Math.abs(txB.amount)
      ? { original: txA, refund: txB }
      : { original: txB, refund: txA };
  }
  return txA.date <= txB.date
    ? { original: txA, refund: txB }
    : { original: txB, refund: txA };
}

// ── Planner Collections & Loan Payment Status ────────────────────────────────

export const PLANNER_COLLECTIONS = new Set([
  "salaryPeriods",
  "recurringCharges",
  "recurringBonuses",
  "vestingGrants",
  "events",
  "scenarioEvents",
]);

export interface PlannerItemLike {
  id: string;
  [key: string]: unknown;
}

/** Upserts an item by `id` into a planner config array (or appends with a generated id). */
export function upsertPlannerCollectionItem(
  items: unknown,
  item: Record<string, unknown>,
  generateId: () => string = () => Math.random().toString(36).slice(2, 10)
): { items: PlannerItemLike[]; saved: PlannerItemLike; action: "created" | "updated" } {
  const list: PlannerItemLike[] = Array.isArray(items)
    ? items.filter((x): x is PlannerItemLike => Boolean(x && typeof x === "object" && typeof (x as PlannerItemLike).id === "string"))
    : [];

  const providedId = typeof item.id === "string" && item.id.trim() ? item.id.trim() : "";
  const existingIdx = providedId ? list.findIndex((x) => x.id === providedId) : -1;

  if (existingIdx >= 0) {
    const merged: PlannerItemLike = { ...list[existingIdx], ...item, id: providedId };
    const next = [...list];
    next[existingIdx] = merged;
    return { items: next, saved: merged, action: "updated" };
  }

  const nextId = providedId || generateId();
  const created: PlannerItemLike = { ...item, id: nextId };
  return { items: [...list, created], saved: created, action: "created" };
}

/** Deletes an item by `id` from a planner config array. */
export function deletePlannerCollectionItem(
  items: unknown,
  itemId: string
): { items: PlannerItemLike[]; deleted: PlannerItemLike | null } {
  const list: PlannerItemLike[] = Array.isArray(items)
    ? items.filter((x): x is PlannerItemLike => Boolean(x && typeof x === "object" && typeof (x as PlannerItemLike).id === "string"))
    : [];
  const target = list.find((x) => x.id === itemId) ?? null;
  if (!target) return { items: list, deleted: null };
  return { items: list.filter((x) => x.id !== itemId), deleted: target };
}

/** Updates paid_loan_ids and config.loanUnpaidMonthOverrides for a specific loan and YYYY-MM month. */
export function applyLoanPaidStatus(params: {
  loanId: string;
  paid: boolean;
  month: string;
  currentPaidLoanIds: string[];
  currentPaidLoanMonth: string;
  currentUnpaidOverrides: Record<string, string>;
}): {
  paid_loan_ids: string[];
  paid_loan_month: string;
  loanUnpaidMonthOverrides: Record<string, string>;
} {
  const { loanId, paid, month, currentPaidLoanIds, currentPaidLoanMonth, currentUnpaidOverrides } = params;
  // Reset paid_loan_ids when switching to a new month (matches PlannerSection behavior).
  const basePaid = currentPaidLoanMonth === month ? [...currentPaidLoanIds] : [];
  const nextOverrides: Record<string, string> = { ...currentUnpaidOverrides };

  if (paid) {
    const nextPaid = basePaid.includes(loanId) ? basePaid : [...basePaid, loanId];
    if (nextOverrides[loanId] === month) delete nextOverrides[loanId];
    return {
      paid_loan_ids: nextPaid,
      paid_loan_month: month,
      loanUnpaidMonthOverrides: nextOverrides,
    };
  }

  const nextPaid = basePaid.filter((id) => id !== loanId);
  nextOverrides[loanId] = month;
  return {
    paid_loan_ids: nextPaid,
    paid_loan_month: month,
    loanUnpaidMonthOverrides: nextOverrides,
  };
}

/** Deterministic fingerprint for deduplicated bulk transaction imports. */
export function buildImportFingerprint(row: {
  sourceKey?: string | null;
  date: string;
  amount: number;
  name: string;
  occurrence?: number;
}): string {
  const src = (row.sourceKey ?? "manual").toLowerCase().trim() || "manual";
  const date = row.date.slice(0, 10);
  const amt = Number(row.amount).toFixed(2);
  const normalizedName = normalizeMerchantKey(row.name) ?? "transaction";
  const occ = row.occurrence ?? 1;
  return `mcp:${src}:${date}:${amt}:${normalizedName}:${occ}`;
}


