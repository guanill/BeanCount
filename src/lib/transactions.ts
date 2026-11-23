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

/**
 * Splits visible transactions into active rows (shown in normal categories) and
 * manually ignored rows (hidden in a collapsed "Ignored" section).
 * `[split]`-ignored originals are excluded from both lists.
 */
export function partitionVisibleTransactions<T extends SplitCheckableTransaction>(
  transactions: T[],
): { active: T[]; ignored: T[] } {
  const active: T[] = [];
  const ignored: T[] = [];
  for (const tx of transactions) {
    if (isSplitOriginal(tx)) continue;
    if (tx.is_ignored) {
      ignored.push(tx);
    } else {
      active.push(tx);
    }
  }
  return { active, ignored };
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

// ─── Refund Linking ──────────────────────────────────────────────────────────

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

/** Strips any internal `[refund:...]` tag from notes for clean display/editing. */
export function stripRefundTag(notes?: string | null): string {
  if (!notes) return "";
  return notes.replace(REFUND_TAG_RE, "").replace(/\s{2,}/g, " ").trim();
}

/** Attaches (or replaces) a `[refund:...]` tag while preserving any user notes. */
export function attachRefundTag(
  existingNotes: string | null | undefined,
  link: RefundLink,
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
      .filter((w) => w.length >= 3),
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
  candidates: T[],
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
