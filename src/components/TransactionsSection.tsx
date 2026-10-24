"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Plus,
  Search,
  Trash2,
  TrendingUp,
  TrendingDown,
  Minus,
  Tag,
  X,
  SlidersHorizontal,
  EyeOff,
  Eye,
  Scissors,
  Save,
  AlertCircle,
  Pencil,
  ArrowLeft,
  Repeat,
  MessageSquare,
  Filter,
  Upload,
} from "lucide-react";
import { Account, CreditCard, Transaction, TransactionSummary } from "@/lib/types";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
import { CATEGORIES, getCategoryMeta } from "@/lib/categories";
import { formatCurrency, formatDate } from "@/lib/format";
import { detectCsvImportSource } from "@/lib/csv-source-detection";
import { createClient } from "@/lib/supabase/client";
import {
  getTransactions as fetchTransactionsFromSupabase,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  splitTransaction,
  getAccounts,
  getCreditCards,
  getTransactionMonthCoverage,
  getTransactionSourceCoverage,
  deleteTransactionsForSource,
  getTellerTransactionCount,
  deleteTellerTransactions,
  importTransactions,
} from "@/lib/supabase/queries";
import { callEdgeFunction } from "@/lib/supabase/functions";
import { useToast } from "./Toast";
import ConfirmDialog from "./ConfirmDialog";

/* â"€â"€â"€ Donut chart â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */
interface DonutSegment { category: string; label: string; color: string; emoji: string; amount: number; }

interface ImportPreviewRow {
  date: string;
  name: string;
  amount: number;
  transaction_type: "income" | "expense";
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"' && quoted) { value += '"'; i++; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (char === "," && !quoted) { values.push(value.trim()); value = ""; continue; }
    value += char;
  }
  values.push(value.trim());
  return values;
}

function parseCsv(text: string): ImportPreviewRow[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) throw new Error("The CSV needs a header row and at least one transaction.");
  const headers = parseCsvLine(lines[0]).map(header => header.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const find = (...names: string[]) => headers.findIndex(header => names.includes(header));
  const dateIndex = find("date", "transactiondate", "posteddate");
  const nameIndex = find("description", "name", "merchant", "payee");
  const amountIndex = find("amount", "transactionamount");
  const debitIndex = find("debit", "withdrawal", "charge");
  const creditIndex = find("credit", "deposit", "payment");
  const typeIndex = find("type", "transactiontype");
  if (dateIndex < 0 || nameIndex < 0 || (amountIndex < 0 && debitIndex < 0 && creditIndex < 0)) {
    throw new Error("Could not identify Date, Description, and Amount columns.");
  }
  const rows: ImportPreviewRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    const rawDate = cells[dateIndex]?.trim() ?? "";
    const parsedDate = new Date(rawDate);
    if (!rawDate || Number.isNaN(parsedDate.getTime())) continue;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
      ? rawDate
      : `${parsedDate.getFullYear()}-${String(parsedDate.getMonth() + 1).padStart(2, "0")}-${String(parsedDate.getDate()).padStart(2, "0")}`;
    const parseAmount = (value: string | undefined) => Math.abs(parseFloat((value ?? "").replace(/[$,\s]/g, "")) || 0);
    const rawAmount = amountIndex >= 0 ? (cells[amountIndex] ?? "") : "";
    const type = (cells[typeIndex] ?? "").toLowerCase();
    const amount = amountIndex >= 0
      ? parseFloat(rawAmount.replace(/[$,\s]/g, "")) || 0
      : parseAmount(cells[debitIndex]) || -parseAmount(cells[creditIndex]);
    const isIncome = type.includes("credit") || type.includes("deposit") || type.includes("income") || amount < 0 || (creditIndex >= 0 && parseAmount(cells[creditIndex]) > 0 && parseAmount(cells[debitIndex]) === 0);
    rows.push({
      date,
      name: cells[nameIndex]?.trim() || "Imported transaction",
      amount: isIncome ? -Math.abs(amount) : Math.abs(amount),
      transaction_type: isIncome ? "income" : "expense",
    });
  }
  if (rows.length === 0) throw new Error("No valid transactions were found in the CSV.");
  return rows;
}

function SpendingDonut({
  segments,
  total,
  highlightedCat,
  onHover,
}: {
  segments: DonutSegment[];
  total: number;
  highlightedCat: string | null;
  onHover: (cat: string | null) => void;
}) {
  const r = 68;
  const cx = 90;
  const cy = 90;
  const C = 2 * Math.PI * r;        // â‰ˆ 427.26
  const GAP = 2;                     // px gap between segments

  if (total === 0 || segments.length === 0) {
    return (
      <svg viewBox="0 0 180 180" className="w-full h-full">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#ffffff10" strokeWidth={20} />
        <text x={cx} y={cy - 6} textAnchor="middle" fill="#ffffff40" fontSize={11}>No expenses</text>
        <text x={cx} y={cy + 12} textAnchor="middle" fill="#ffffff20" fontSize={10}>this period</text>
      </svg>
    );
  }

  // Build arc segments (pure - no mutation)
  const rawArcs = segments.map(seg => (seg.amount / total) * C);
  const cumulatives = rawArcs.reduce<number[]>((acc, val, i) => {
    acc.push(i === 0 ? 0 : acc[i - 1] + rawArcs[i - 1]);
    return acc;
  }, []);
  const arcs = segments.map((seg, i) => ({
    ...seg,
    arc:    Math.max(rawArcs[i] - GAP, 0),
    offset: C * 0.25 - cumulatives[i],
  }));

  const hovered = segments.find(s => s.category === highlightedCat);
  const centerLabel = hovered
    ? { value: formatCurrency(hovered.amount), sub: hovered.label }
    : { value: formatCurrency(total), sub: "Total expenses" };

  return (
    <svg viewBox="0 0 180 180" className="w-full h-full">
      {/* Background ring */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#ffffff08" strokeWidth={20} />

      {arcs.map((seg) => (
        <circle
          key={seg.category}
          cx={cx} cy={cy} r={r}
          fill="none"
          strokeWidth={highlightedCat === seg.category ? 24 : 20}
          stroke={seg.color}
          strokeOpacity={highlightedCat && highlightedCat !== seg.category ? 0.25 : 1}
          strokeLinecap="round"
          strokeDasharray={`${seg.arc} ${C - seg.arc}`}
          strokeDashoffset={seg.offset}
          className="transition-all duration-300 cursor-pointer"
          onMouseEnter={() => onHover(seg.category)}
          onMouseLeave={() => onHover(null)}
        />
      ))}

      {/* Center text */}
      <text x={cx} y={cy - 8} textAnchor="middle" fill="#ffffff" fontSize={13} fontWeight="700">
        {centerLabel.value}
      </text>
      <text x={cx} y={cy + 10} textAnchor="middle" fill="#ffffff60" fontSize={9}>
        {centerLabel.sub}
      </text>
    </svg>
  );
}

/* ─── Recurring / subscription detection ───────────────────────────────────── */
function detectRecurringIds(txs: Transaction[]): Set<string> {
  // Group by normalized merchant/name
  const groups = new Map<string, Transaction[]>();
  for (const tx of txs) {
    if (tx.transaction_type !== "expense" || tx.is_ignored) continue;
    const key = (tx.merchant_name || tx.name).toLowerCase().trim();
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(tx);
    groups.set(key, list);
  }
  const recurringIds = new Set<string>();
  for (const [, group] of groups) {
    if (group.length < 2) continue;
    // Check if amounts are similar (within 20% of median)
    const amounts = group.map(t => Math.abs(t.amount)).sort((a, b) => a - b);
    const median = amounts[Math.floor(amounts.length / 2)];
    if (median === 0) continue;
    const similar = group.filter(t => Math.abs(Math.abs(t.amount) - median) / median < 0.2);
    if (similar.length < 2) continue;
    // Check for roughly monthly pattern (25-35 day gaps between at least 2 consecutive)
    const dates = similar.map(t => new Date(t.date).getTime()).sort((a, b) => a - b);
    let hasMonthlyGap = false;
    for (let i = 1; i < dates.length; i++) {
      const dayGap = (dates[i] - dates[i - 1]) / (1000 * 60 * 60 * 24);
      if (dayGap >= 25 && dayGap <= 40) { hasMonthlyGap = true; break; }
    }
    if (hasMonthlyGap) {
      for (const t of similar) recurringIds.add(t.id);
    }
  }
  return recurringIds;
}

/* ─── Transaction row ──────────────────────────────────────────────────────── */
function TxRow({
  tx,
  onDelete,
  onReclassify,
  onClick,
  isRecurring,
}: {
  tx: Transaction;
  onDelete: (id: string) => void;
  onReclassify: (id: string, newCat: string) => void;
  onClick: () => void;
  isRecurring?: boolean;
}) {
  const meta      = getCategoryMeta(tx.category);
  const isIncome  = tx.transaction_type === "income";
  const isIgnored = tx.is_ignored;
  const displayAmt = Math.abs(tx.amount);

  return (
    <div
      className={`group flex items-center gap-2 sm:gap-3 px-2 sm:px-3 py-2 sm:py-2.5 rounded-xl hover:bg-background/60 transition-colors cursor-pointer ${isIgnored ? "opacity-40" : ""}`}
      onClick={onClick}
    >
      <div
        className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg flex items-center justify-center text-xs sm:text-sm shrink-0"
        style={{ backgroundColor: meta.color + "20" }}
      >
        {meta.emoji}
      </div>

      <div className="flex-1 min-w-0">
        <p className={`text-xs sm:text-sm font-medium truncate ${isIgnored ? "line-through text-foreground/40" : "text-foreground"}`}>
          {tx.merchant_name || tx.name}
        </p>
        <div className="flex items-center gap-1.5 sm:gap-2 mt-0.5 flex-wrap">
          <span className="text-[10px] sm:text-xs text-foreground/40">{formatDate(tx.date)}</span>
          <select
            value={tx.category}
            aria-label={`Category for ${tx.merchant_name || tx.name}`}
            title="Change category"
            onClick={event => event.stopPropagation()}
            onChange={event => onReclassify(tx.id, event.target.value)}
            className="max-w-32 cursor-pointer rounded-full border-0 px-1.5 py-0.5 text-[10px] sm:text-xs focus:outline-none focus:ring-1 focus:ring-accent"
            style={{ backgroundColor: meta.color + "20", color: meta.color }}
          >
            {Object.entries(CATEGORIES).map(([key, category]) => (
              <option key={key} value={key} className="bg-card text-foreground">
                {category.emoji} {category.label}
              </option>
            ))}
          </select>
          {tx.account_name && <span className="text-[10px] sm:text-xs text-foreground/30 truncate max-w-24 sm:max-w-40">{tx.account_name}</span>}
          {isRecurring && <span className="flex items-center gap-0.5 text-[10px] sm:text-xs text-purple-400/70"><Repeat className="w-2.5 h-2.5" /> recurring</span>}
          {isIgnored && <span className="flex items-center gap-0.5 text-[10px] sm:text-xs text-foreground/30"><EyeOff className="w-2.5 h-2.5" /> ignored</span>}
          {tx.is_manual && <span className="text-[10px] sm:text-xs text-foreground/25">manual</span>}
          {tx.notes && <span className="flex items-center gap-0.5 text-[10px] sm:text-xs text-foreground/25 italic truncate max-w-20 sm:max-w-32"><MessageSquare className="w-2.5 h-2.5 shrink-0" />{tx.notes}</span>}
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
        <span className={`text-xs sm:text-sm font-bold ${isIgnored ? "line-through text-foreground/30" : isIncome ? "text-green-400" : "text-foreground/90"}`}>
          {isIncome ? "+" : "-"}{formatCurrency(displayAmt)}
        </span>
        {tx.is_manual && (
          <button onClick={() => onDelete(tx.id)} aria-label={`Delete ${tx.name}`} className="flex sm:hidden sm:group-hover:flex p-1 text-foreground/20 hover:text-red-400 transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

/* ─── Transaction Detail Panel ──────────────────────────────────────────────── */
interface SplitPart { name: string; amount: string; category: string; transaction_type: "income" | "expense" | "transfer"; }

function TransactionDetailPanel({
  tx,
  onClose,
  onSave,
  onIgnore,
  onSplit,
  onDelete,
}: {
  tx: Transaction;
  onClose: () => void;
  onSave: (id: string, updates: Record<string, string | number>) => Promise<void>;
  onIgnore: (id: string, ignore: boolean) => Promise<void>;
  onSplit: (id: string, a: SplitPart, b: SplitPart) => Promise<void>;
  onDelete: (id: string) => void;
}) {
  const meta = getCategoryMeta(tx.category);
  const isIgnored = tx.is_ignored;
  const [mode, setMode] = useState<"view" | "edit" | "split">("view");
  const [saving, setSaving] = useState(false);

  // Edit state
  const [editName,     setEditName]     = useState(tx.merchant_name || tx.name);
  const [editCategory, setEditCategory] = useState(tx.category);
  const [editType,     setEditType]     = useState(tx.transaction_type);
  const [editNotes,    setEditNotes]    = useState(tx.notes ?? "");
  const [editAmount,   setEditAmount]   = useState(String(Math.abs(tx.amount)));

  // Split state
  const origAmt = Math.abs(tx.amount);
  const [splitAName, setSplitAName] = useState(tx.merchant_name || tx.name);
  const [splitAAmt,  setSplitAAmt]  = useState((origAmt / 2).toFixed(2));
  const [splitACat,  setSplitACat]  = useState(tx.category);
  const [splitAType, setSplitAType] = useState(tx.transaction_type);
  const [splitBName, setSplitBName] = useState(tx.merchant_name || tx.name);
  const [splitBCat,  setSplitBCat]  = useState(tx.category);

  const splitBAmtNum = Math.max(0, origAmt - parseFloat(splitAAmt || "0"));
  const splitBAmount = splitBAmtNum.toFixed(2);
  const splitValid   = Math.abs(parseFloat(splitAAmt || "0") + splitBAmtNum - origAmt) < 0.01
                    && parseFloat(splitAAmt || "0") > 0 && splitBAmtNum > 0;

  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    setPortalEl(el);
    return () => { el.remove(); };
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const updates: Record<string, string | number> = {
        name: editName, category: editCategory, transaction_type: editType, notes: editNotes,
      };
      if (tx.is_manual) {
        const n = parseFloat(editAmount);
        updates.amount = editType === "income" ? -Math.abs(n) : Math.abs(n);
      }
      await onSave(tx.id, updates);
      setMode("view");
    } finally { setSaving(false); }
  }

  async function handleSplitConfirm() {
    setSaving(true);
    try {
      const a: SplitPart = { name: splitAName, amount: splitAAmt, category: splitACat, transaction_type: splitAType };
      const b: SplitPart = { name: splitBName, amount: splitBAmount, category: splitBCat, transaction_type: tx.transaction_type };
      await onSplit(tx.id, a, b);
    } finally { setSaving(false); }
  }

  if (!portalEl) return null;
  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)" }} onClick={mode === "view" ? onClose : undefined} />
      <div className="relative w-80 bg-card border border-border/60 rounded-2xl shadow-2xl overflow-hidden" style={{ zIndex: 1 }}>

          {/* ── VIEW mode ── */}
          {mode === "view" && (
            <>
              {/* Top strip */}
              <div className="flex items-center justify-between px-4 pt-4 pb-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: meta.color + "22" }}>
                    <span className="text-base">{meta.emoji}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate leading-tight">{tx.merchant_name || tx.name}</p>
                    <p className="text-xs text-foreground/40">{formatDate(tx.date)}</p>
                  </div>
                </div>
                <button onClick={onClose} className="p-1 rounded-lg text-foreground/30 hover:text-foreground transition-colors shrink-0">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Amount row */}
              <div className="px-4 pb-3 flex items-center gap-2">
                <span className={`text-2xl font-bold tabular-nums ${tx.transaction_type === "income" ? "text-green-400" : isIgnored ? "text-foreground/30 line-through" : "text-foreground"}`}>
                  {tx.transaction_type === "income" ? "+" : "-"}{formatCurrency(Math.abs(tx.amount))}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: meta.color + "20", color: meta.color }}>{meta.label}</span>
                {isIgnored && <span className="flex items-center gap-0.5 text-xs text-foreground/30"><EyeOff className="w-3 h-3" /> ignored</span>}
              </div>

              {/* Info row */}
              <div className="mx-4 mb-3 px-3 py-2 rounded-xl bg-background/60 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-foreground/50">
                <span className="capitalize">{tx.transaction_type}</span>
                {tx.account_name && <><span className="text-foreground/30">·</span><span className="font-medium text-foreground/60 truncate">{tx.account_name}</span></>}
                {tx.notes && <><span className="text-foreground/30">·</span><span className="truncate max-w-24 italic">{tx.notes}</span></>}
              </div>

              {/* Action buttons */}
              <div className="px-4 pb-3 grid grid-cols-2 gap-2">
                <button onClick={() => setMode("edit")}
                  className="flex items-center justify-center gap-1.5 py-2 rounded-xl bg-accent/10 text-accent border border-accent/20 text-xs font-medium hover:bg-accent/20 transition-colors">
                  <Pencil className="w-3.5 h-3.5" /> Edit
                </button>
                {!isIgnored ? (
                  <button onClick={() => setMode("split")}
                    className="flex items-center justify-center gap-1.5 py-2 rounded-xl bg-background border border-border/40 text-foreground/60 text-xs font-medium hover:text-foreground transition-colors">
                    <Scissors className="w-3.5 h-3.5" /> Split
                  </button>
                ) : <div />}
              </div>

              {/* Ignore + delete */}
              <div className="px-4 pb-4 space-y-1.5">
                <button onClick={() => onIgnore(tx.id, !isIgnored)}
                  className={`w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border text-xs font-medium transition-colors ${isIgnored ? "border-accent/30 text-accent bg-accent/10 hover:bg-accent/20" : "border-border/40 text-foreground/40 hover:text-foreground/70 hover:border-border/60"}`}>
                  {isIgnored ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  {isIgnored ? "Un-ignore" : "Ignore transaction"}
                </button>
                {tx.is_manual && (
                  <button onClick={() => { onDelete(tx.id); onClose(); }}
                    className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border border-red-500/20 text-red-400 text-xs hover:bg-red-500/10 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" /> Delete
                  </button>
                )}
              </div>
            </>
          )}

          {/* ── EDIT mode ── */}
          {mode === "edit" && (
            <>
              <div className="flex items-center gap-2 px-4 pt-4 pb-3 border-b border-border/20">
                <button onClick={() => setMode("view")} className="p-1 text-foreground/40 hover:text-foreground transition-colors">
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <p className="text-sm font-semibold text-foreground">Edit transaction</p>
                <button onClick={onClose} className="ml-auto p-1 text-foreground/30 hover:text-foreground transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="px-4 py-3 space-y-3 max-h-96 overflow-y-auto">
                {tx.is_manual && (
                  <div>
                    <label className="text-xs text-foreground/40 block mb-1">Amount</label>
                    <input type="number" step="0.01" min="0" value={editAmount} onChange={e => setEditAmount(e.target.value)}
                      className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm font-bold text-foreground focus:outline-none focus:border-accent" />
                  </div>
                )}
                <div>
                  <label className="text-xs text-foreground/40 block mb-1">Name</label>
                  <input type="text" value={editName} onChange={e => setEditName(e.target.value)}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-accent" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-foreground/40 block mb-1">Category</label>
                    <select value={editCategory} onChange={e => { setEditCategory(e.target.value); setEditType(getCategoryMeta(e.target.value).type as "income" | "expense" | "transfer"); }}
                      className="w-full bg-background border border-border rounded-lg px-2 py-2 text-xs text-foreground focus:outline-none focus:border-accent">
                      {Object.entries(CATEGORIES).map(([key, m]) => <option key={key} value={key}>{m.emoji} {m.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-foreground/40 block mb-1">Type</label>
                    <select value={editType} onChange={e => setEditType(e.target.value as "income" | "expense" | "transfer")}
                      className="w-full bg-background border border-border rounded-lg px-2 py-2 text-xs text-foreground focus:outline-none focus:border-accent">
                      <option value="expense">Expense</option>
                      <option value="income">Income</option>
                      <option value="transfer">Transfer</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-foreground/40 block mb-1">Notes</label>
                  <input type="text" value={editNotes} onChange={e => setEditNotes(e.target.value)} placeholder="Optional note…"
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-accent" />
                </div>
              </div>
              <div className="px-4 py-3 border-t border-border/20 flex gap-2">
                <button onClick={() => setMode("view")} className="flex-1 py-2 rounded-xl border border-border/40 text-foreground/50 text-xs hover:text-foreground transition-colors">Cancel</button>
                <button onClick={handleSave} disabled={saving}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-accent text-white text-xs font-medium hover:bg-accent/90 disabled:opacity-40 transition-colors">
                  <Save className="w-3.5 h-3.5" />{saving ? "Saving…" : "Save"}
                </button>
              </div>
            </>
          )}

          {/* ── SPLIT mode ── */}
          {mode === "split" && (
            <>
              <div className="flex items-center gap-2 px-4 pt-4 pb-3 border-b border-border/20">
                <button onClick={() => setMode("view")} className="p-1 text-foreground/40 hover:text-foreground transition-colors">
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">Split transaction</p>
                  <p className="text-xs text-foreground/40">Total: {formatCurrency(origAmt)}</p>
                </div>
                <button onClick={onClose} className="ml-auto p-1 text-foreground/30 hover:text-foreground transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="px-4 py-3 space-y-3 max-h-96 overflow-y-auto">
                <p className="text-xs text-foreground/40">Original will be ignored; two new transactions created.</p>

                {/* Part A */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-foreground/50 uppercase tracking-wider">Part A</p>
                  <input type="text" placeholder="Name" value={splitAName} onChange={e => setSplitAName(e.target.value)}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-accent" />
                  <div className="flex gap-2">
                    <input type="number" step="0.01" min="0" placeholder="Amount" value={splitAAmt} onChange={e => setSplitAAmt(e.target.value)}
                      className="w-28 bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-accent" />
                    <select value={splitACat} onChange={e => setSplitACat(e.target.value)}
                      className="flex-1 bg-background border border-border rounded-lg px-2 py-2 text-xs text-foreground focus:outline-none focus:border-accent">
                      {Object.entries(CATEGORIES).map(([k, m]) => <option key={k} value={k}>{m.emoji} {m.label}</option>)}
                    </select>
                  </div>
                </div>

                <div className="border-t border-border/20" />

                {/* Part B */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-foreground/50 uppercase tracking-wider">Part B</p>
                  <input type="text" placeholder="Name" value={splitBName} onChange={e => setSplitBName(e.target.value)}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-accent" />
                  <div className="flex gap-2">
                    <div className="w-28 flex items-center px-3 py-2 bg-background/40 border border-border/40 rounded-lg text-sm font-semibold text-foreground/50 tabular-nums">
                      {formatCurrency(splitBAmtNum)}
                    </div>
                    <select value={splitBCat} onChange={e => setSplitBCat(e.target.value)}
                      className="flex-1 bg-background border border-border rounded-lg px-2 py-2 text-xs text-foreground focus:outline-none focus:border-accent">
                      {Object.entries(CATEGORIES).map(([k, m]) => <option key={k} value={k}>{m.emoji} {m.label}</option>)}
                    </select>
                  </div>
                </div>

                {!splitValid && parseFloat(splitAAmt || "0") > 0 && (
                  <p className="flex items-center gap-1 text-xs text-yellow-400">
                    <AlertCircle className="w-3.5 h-3.5" /> Part A cannot exceed {formatCurrency(origAmt)}
                  </p>
                )}
              </div>
              <div className="px-4 py-3 border-t border-border/20 flex gap-2">
                <button onClick={() => setMode("view")} className="flex-1 py-2 rounded-xl border border-border/40 text-foreground/50 text-xs hover:text-foreground transition-colors">Cancel</button>
                <button onClick={handleSplitConfirm} disabled={!splitValid || saving}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-accent/15 text-accent border border-accent/20 text-xs font-medium hover:bg-accent/25 disabled:opacity-40 transition-colors">
                  <Scissors className="w-3.5 h-3.5" />{saving ? "Splitting…" : "Confirm"}
                </button>
              </div>
            </>
          )}

      </div>
    </div>,
    portalEl
  );
}

/* â"€â"€â"€ Add form interface â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */
interface AddForm {
  name: string; amount: string; date: string;
  category: string; transaction_type: "income" | "expense" | "transfer"; notes: string;
}
const emptyForm: AddForm = {
  name: "", amount: "", date: new Date().toISOString().slice(0, 10),
  category: "other", transaction_type: "expense", notes: "",
};

/* â"€â"€â"€ Main component â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */
export default function TransactionsSection() {
  const { toast } = useToast();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const now = new Date();
  const [year,     setYear]    = useState(now.getFullYear());
  const [month,    setMonth]   = useState(now.getMonth() + 1);
  const [viewMode, setViewMode] = useState<"month" | "year">("month");

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [summary,      setSummary]      = useState<TransactionSummary | null>(null);
  const [monthCoverage, setMonthCoverage] = useState<Record<number, number>>({});
  const [coverageLoading, setCoverageLoading] = useState(true);
  const [coverageError, setCoverageError] = useState(false);
  const [loading,  setLoading]  = useState(true);
  const [syncing,  setSyncing]  = useState(false);
  const [syncMsg,  setSyncMsg]  = useState<string | null>(null);
  const [query,    setQuery]    = useState("");

  const [showAdd,  setShowAdd]  = useState(false);
  const [addForm,  setAddForm]  = useState<AddForm>(emptyForm);
  const [saving,   setSaving]   = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importRows, setImportRows] = useState<ImportPreviewRow[]>([]);
  const [importSource, setImportSource] = useState("");
  const [importCsvText, setImportCsvText] = useState("");
  const [importFileName, setImportFileName] = useState("");
  const [sourceAutoDetected, setSourceAutoDetected] = useState(false);
  const [sourceDetectionMessage, setSourceDetectionMessage] = useState("");
  const [sourceCoverage, setSourceCoverage] = useState<{
    source: string;
    monthCounts: Record<number, number>;
    latestAddedAt: string | null;
    totalTransactionCount: number;
  } | null>(null);
  const [sourceCoverageLoading, setSourceCoverageLoading] = useState(false);
  const [sourceCoverageError, setSourceCoverageError] = useState(false);
  const [sourceCoverageRefresh, setSourceCoverageRefresh] = useState(0);
  const [deleteSource, setDeleteSource] = useState<{ kind: "account" | "card"; id: string; name: string; count: number } | null>(null);
  const [deletingSource, setDeletingSource] = useState(false);
  const [tellerTransactionCount, setTellerTransactionCount] = useState<number | null>(null);
  const [tellerCountLoading, setTellerCountLoading] = useState(false);
  const [tellerCountError, setTellerCountError] = useState(false);
  const [deleteTellerConfirmation, setDeleteTellerConfirmation] = useState(false);
  const [deletingTellerTransactions, setDeletingTellerTransactions] = useState(false);
  const [importError, setImportError] = useState("");
  const [importing, setImporting] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [creditCards, setCreditCards] = useState<CreditCard[]>([]);

  // Accordion: which categories are open
  const [openCats, setOpenCats] = useState<Set<string>>(new Set());
  // Donut hover
  const [hoveredCat, setHoveredCat] = useState<string | null>(null);
  // Client-side filters
  const [typeFilter, setTypeFilter] = useState<"all" | "expense" | "income" | "transfer">("all");
  const [catFilter,  setCatFilter]  = useState<string | null>(null);
  // Advanced filters
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [recurringOnly, setRecurringOnly] = useState(false);
  // Detail panel
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);

  /* â"€â"€ Data fetching â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */
  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const filters: { month?: number; year?: number } = { year };
      if (viewMode === "month") filters.month = month;
      const data = await fetchTransactionsFromSupabase(supabase, filters);
      setTransactions(data.transactions ?? []);
      setSummary(data.summary ?? null);
      setCoverageLoading(true);
      setCoverageError(false);
      try {
        setMonthCoverage(await getTransactionMonthCoverage(supabase, year));
      } catch (err) {
        console.error("Failed to fetch transaction month coverage:", err);
        setCoverageError(true);
      } finally {
        setCoverageLoading(false);
      }
    } catch (err) {
      console.error("Failed to fetch transactions:", err);
      setCoverageError(true);
      setCoverageLoading(false);
    } finally {
      setLoading(false);
    }
  }, [year, month, viewMode]);

  useEffect(() => { fetchTransactions(); }, [fetchTransactions]);

  useEffect(() => {
    const supabase = createClient();
    Promise.all([getAccounts(supabase), getCreditCards(supabase)])
      .then(([loadedAccounts, loadedCards]) => { setAccounts(loadedAccounts); setCreditCards(loadedCards); })
      .catch(error => console.error("Failed to load import accounts:", error));
  }, []);

  useEffect(() => {
    if (!showImport || !importSource) {
      setSourceCoverage(null);
      setSourceCoverageError(false);
      setSourceCoverageLoading(false);
      return;
    }

    const [kind, sourceId] = importSource.split(":");
    if ((kind !== "account" && kind !== "card") || !sourceId) return;

    let active = true;
    setSourceCoverage(null);
    setSourceCoverageLoading(true);
    setSourceCoverageError(false);
    getTransactionSourceCoverage(createClient(), kind, sourceId, year)
      .then(coverage => { if (active) setSourceCoverage({ source: importSource, ...coverage }); })
      .catch(error => {
        console.error("Failed to load selected source CSV coverage:", error);
        if (active) setSourceCoverageError(true);
      })
      .finally(() => { if (active) setSourceCoverageLoading(false); });

    return () => { active = false; };
  }, [showImport, importSource, year, sourceCoverageRefresh]);

  useEffect(() => {
    if (!showImport) {
      setTellerTransactionCount(null);
      setTellerCountError(false);
      return;
    }

    let active = true;
    setTellerCountLoading(true);
    setTellerCountError(false);
    getTellerTransactionCount(createClient())
      .then(count => { if (active) setTellerTransactionCount(count); })
      .catch(error => {
        console.error("Failed to count Teller-linked transactions:", error);
        if (active) setTellerCountError(true);
      })
      .finally(() => { if (active) setTellerCountLoading(false); });

    return () => { active = false; };
  }, [showImport, sourceCoverageRefresh]);

  useEffect(() => {
    if (!importCsvText || !importFileName) return;
    const sources = [
      ...accounts.filter(account => account.type === "bank" || account.type === "cash")
        .map(account => ({ value: `account:${account.id}`, name: account.name })),
      ...creditCards.map(card => ({ value: `card:${card.id}`, name: card.name })),
    ];
    const detected = detectCsvImportSource(importFileName, importCsvText, sources);
    if (detected) {
      setImportSource(detected);
      setSourceAutoDetected(true);
      const detectedSource = sources.find(source => source.value === detected);
      setSourceDetectionMessage(`Matched ${detectedSource?.name ?? "source"} from the file.`);
    } else {
      setImportSource("");
      setSourceAutoDetected(false);
      setSourceDetectionMessage("Could not identify one source from this file. Choose an account or card below.");
    }
  }, [importCsvText, importFileName, accounts, creditCards]);

  const importPreviewMonths = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of importRows) {
      const key = row.date.slice(0, 7);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts, ([key, count]) => {
      const [rowYear, rowMonth] = key.split("-").map(Number);
      return { key, label: `${MONTHS[rowMonth - 1]} ${rowYear}`, count };
    }).sort((a, b) => a.key.localeCompare(b.key));
  }, [importRows]);

  /* â"€â"€ Group transactions by category (client-side) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */
  // Recurring detection (memoized on full transaction list)
  const recurringIds = useMemo(() => detectRecurringIds(transactions), [transactions]);

  // Client-side filtered list: search + type + category + amount + date + recurring
  const filtered = useMemo(() => {
    let list = transactions;
    if (typeFilter !== "all") list = list.filter(t => t.transaction_type === typeFilter);
    if (catFilter) list = list.filter(t => t.category === catFilter);
    if (recurringOnly) list = list.filter(t => recurringIds.has(t.id));
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(t =>
        t.name.toLowerCase().includes(q) ||
        (t.merchant_name?.toLowerCase() ?? "").includes(q) ||
        (t.notes?.toLowerCase() ?? "").includes(q) ||
        (t.account_name?.toLowerCase() ?? "").includes(q) ||
        getCategoryMeta(t.category).label.toLowerCase().includes(q)
      );
    }
    const minAmt = parseFloat(minAmount);
    const maxAmt = parseFloat(maxAmount);
    if (!isNaN(minAmt)) list = list.filter(t => Math.abs(t.amount) >= minAmt);
    if (!isNaN(maxAmt)) list = list.filter(t => Math.abs(t.amount) <= maxAmt);
    if (dateFrom) list = list.filter(t => t.date >= dateFrom);
    if (dateTo) list = list.filter(t => t.date <= dateTo);
    return [...list].sort((a, b) => b.date.localeCompare(a.date));
  }, [transactions, typeFilter, catFilter, query, minAmount, maxAmount, dateFrom, dateTo, recurringOnly, recurringIds]);

  // Grouped by category (from filtered - used in accordion)
  const grouped = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    for (const tx of filtered) {
      const list = map.get(tx.category) ?? [];
      list.push(tx);
      map.set(tx.category, list);
    }
    return Array.from(map.entries())
      .map(([cat, txs]) => {
        const meta  = getCategoryMeta(cat);
        const total = txs.reduce((s, t) => s + Math.abs(t.amount), 0);
        return { cat, meta, txs, total };
      })
      .sort((a, b) => b.total - a.total);
  }, [filtered]);

  /* â"€â"€ Donut segments â€" expenses only â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */
  // Donut always uses the full period - stays stable while searching/filtering
  const allExpenseGroups = useMemo(() => {
    const map = new Map<string, number>();
    for (const tx of transactions) {
      if (tx.transaction_type !== "expense") continue;
      if (tx.is_ignored) continue;
      map.set(tx.category, (map.get(tx.category) ?? 0) + Math.abs(tx.amount));
    }
    return Array.from(map.entries())
      .map(([cat, amount]) => ({ cat, amount, meta: getCategoryMeta(cat) }))
      .sort((a, b) => b.amount - a.amount);
  }, [transactions]);

  const donutSegments = useMemo((): DonutSegment[] =>
    allExpenseGroups
      .filter(g => g.meta.type === "expense")
      .map(g => ({ category: g.cat, label: g.meta.label, color: g.meta.color, emoji: g.meta.emoji, amount: g.amount })),
    [allExpenseGroups]
  );

  const donutTotal = donutSegments.reduce((s, d) => s + d.amount, 0);

  /* â"€â"€ Actions â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */
  async function handleSyncTransactions() {
    setSyncing(true); setSyncMsg(null);
    try {
      const data = await callEdgeFunction<{ added: number; message?: string }>("teller-sync-transactions");
      if (data.added === 0 && data.message) {
        setSyncMsg(data.message);
      } else {
        setSyncMsg(`✓ ${data.added} new`);
      }
      fetchTransactions();
      setTimeout(() => setSyncMsg(null), 5000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Sync failed";
      setSyncMsg(msg.length > 40 ? "Sync failed" : msg);
    } finally {
      setSyncing(false);
    }
  }

  async function handleAdd() {
    if (!addForm.name.trim() || !addForm.amount) return;
    setSaving(true);
    try {
      const supabase = createClient();
      await createTransaction(supabase, {
        ...addForm,
        amount: addForm.transaction_type === "income"
          ? -Math.abs(parseFloat(addForm.amount))
          : Math.abs(parseFloat(addForm.amount)),
      });
      setAddForm(emptyForm); setShowAdd(false); fetchTransactions();
    } finally { setSaving(false); }
  }

  async function handleImportFile(file: File | undefined) {
    if (!file) return;
    setImportError("");
    try {
      const csvText = await file.text();
      setImportRows(parseCsv(csvText));
      setImportCsvText(csvText);
      setImportFileName(file.name);
      setSourceDetectionMessage("Checking the file for a matching account or card…");
    } catch (error) {
      setImportRows([]);
      setImportCsvText("");
      setImportFileName("");
      setImportSource("");
      setSourceAutoDetected(false);
      setSourceDetectionMessage("");
      setImportError(error instanceof Error ? error.message : "Could not read this CSV.");
    }
  }

  async function handleImport() {
    if (!importSource || importRows.length === 0) return;
    setImporting(true);
    try {
      const [kind, id] = importSource.split(":");
      const sourceName = kind === "account"
        ? accounts.find(account => account.id === id)?.name
        : creditCards.find(card => card.id === id)?.name;
      const rows = importRows.map((row, index) => ({
        ...row,
        ...(kind === "account" ? { account_id: id } : { credit_card_id: id }),
        import_fingerprint: `${kind}:${id}:${row.date}:${row.amount}:${row.name.toLowerCase().trim()}:${index}`,
        source_name: kind === "account"
          ? accounts.find(account => account.id === id)?.name
          : creditCards.find(card => card.id === id)?.name,
        merchant_name: row.name,
      }));
      const inserted = await importTransactions(createClient(), rows);
      toast(`${inserted.length} transaction${inserted.length === 1 ? "" : "s"} imported to ${sourceName ?? "account"}`);
      setImportRows([]);
      setImportSource("");
      setImportCsvText("");
      setImportFileName("");
      setSourceAutoDetected(false);
      setSourceDetectionMessage("");
      setShowImport(false);
      fetchTransactions();
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Could not import transactions.");
    } finally {
      setImporting(false);
    }
  }

  async function handleDeleteSourceTransactions() {
    if (!deleteSource) return;
    setDeletingSource(true);
    try {
      const deletedCount = await deleteTransactionsForSource(
        createClient(),
        deleteSource.kind,
        deleteSource.id,
      );
      toast(`${deletedCount} transaction${deletedCount === 1 ? "" : "s"} deleted from ${deleteSource.name}`);
      setDeleteSource(null);
      setSourceCoverageRefresh(value => value + 1);
      void fetchTransactions();
    } catch (error) {
      console.error("Failed to delete transactions for source:", error);
      toast(error instanceof Error ? `Could not delete transactions: ${error.message}` : "Could not delete transactions for this source.", "error");
    } finally {
      setDeletingSource(false);
    }
  }

  async function handleDeleteTellerTransactions() {
    setDeletingTellerTransactions(true);
    try {
      const deletedCount = await deleteTellerTransactions(createClient());
      toast(`${deletedCount} Teller transaction${deletedCount === 1 ? "" : "s"} deleted`);
      setDeleteTellerConfirmation(false);
      setSourceCoverageRefresh(value => value + 1);
      void fetchTransactions();
    } catch (error) {
      console.error("Failed to delete Teller-linked transactions:", error);
      toast(error instanceof Error ? `Could not delete Teller transactions: ${error.message}` : "Could not delete Teller transactions.", "error");
    } finally {
      setDeletingTellerTransactions(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      const supabase = createClient();
      await deleteTransaction(supabase, id);
      toast("Transaction deleted");
      fetchTransactions();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("Failed to delete transaction:", e);
      toast("Failed to delete transaction: " + msg, "error");
    }
  }

  async function handleReclassify(id: string, newCategory: string) {
    try {
      const newMeta = getCategoryMeta(newCategory);
      const newType = newMeta.type;
      const supabase = createClient();
      await updateTransaction(supabase, id, { category: newCategory, transaction_type: newType });
      toast("Transaction reclassified");
      fetchTransactions();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("Failed to reclassify transaction:", e);
      toast("Failed to reclassify transaction: " + msg, "error");
    }
  }

  async function handlePatch(id: string, updates: Record<string, string | number>) {
    try {
      const supabase = createClient();
      await updateTransaction(supabase, id, updates as any);
      toast("Transaction updated");
      await fetchTransactions();
      setSelectedTx(prev => prev?.id === id ? { ...prev, ...updates } as Transaction : prev);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("Failed to update transaction:", e);
      toast("Failed to update transaction: " + msg, "error");
    }
  }

  async function handleIgnore(id: string, ignore: boolean) {
    try {
      const supabase = createClient();
      await updateTransaction(supabase, id, { is_ignored: ignore });
      toast("Transaction updated");
      await fetchTransactions();
      setSelectedTx(prev => prev?.id === id ? { ...prev, is_ignored: ignore } : prev);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("Failed to update transaction:", e);
      toast("Failed to update transaction: " + msg, "error");
    }
  }

  async function handleSplit(id: string, a: SplitPart, b: SplitPart) {
    try {
      const supabase = createClient();
      await splitTransaction(
        supabase,
        id,
        { ...a, amount: parseFloat(a.amount) || 0 },
        { ...b, amount: parseFloat(b.amount) || 0 },
      );
      setSelectedTx(null);
      toast("Transaction split");
      fetchTransactions();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("Failed to split transaction:", e);
      toast("Failed to split transaction: " + msg, "error");
    }
  }

  function toggleCat(cat: string) {
    setOpenCats(prev => {
      const next = new Set(prev);
      if (next.has(cat)) { next.delete(cat); } else { next.add(cat); }
      return next;
    });
    setHoveredCat(cat);
  }

  function handleDonutClick(cat: string) {
    setCatFilter(prev => prev === cat ? null : cat);
    setHoveredCat(cat);
  }

  function prevPeriod() {
    if (viewMode === "year") { setYear(y => y - 1); return; }
    if (month === 1) { setMonth(12); setYear(y => y - 1); } else setMonth(m => m - 1);
  }
  function nextPeriod() {
    if (viewMode === "year") { setYear(y => y + 1); return; }
    if (month === 12) { setMonth(1); setYear(y => y + 1); } else setMonth(m => m + 1);
  }
  const periodLabel = viewMode === "year" ? String(year) : `${MONTHS[month - 1]} ${year}`;
  const [importSourceKind, importSourceId] = importSource.split(":");
  const selectedImportSourceName = importSourceKind === "account"
    ? accounts.find(account => account.id === importSourceId)?.name
    : creditCards.find(card => card.id === importSourceId)?.name;
  const activeSourceCoverage = sourceCoverage?.source === importSource ? sourceCoverage : null;

  /* â"€â"€ Render â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */
  return (
    <div className="rounded-2xl border border-border/50 bg-card p-6 animate-slide-up">

      {/* â"€â"€ Header â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
      <div className="space-y-3 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-foreground">Transactions</h2>
            <p className="text-xs sm:text-sm text-foreground/40 mt-0.5">Spending and income</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleSyncTransactions} disabled={syncing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-border/40 hover:border-accent/30 text-foreground/60 hover:text-accent transition-colors disabled:opacity-40">
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
              {syncMsg ?? (syncing ? "Syncing…" : "Sync")}
            </button>
            <button onClick={() => { setShowImport(!showImport); setImportError(""); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-accent/30 text-accent-light hover:bg-accent/10 transition-colors">
              <Upload className="w-3.5 h-3.5" /> Import CSV
            </button>
            <button onClick={() => setShowAdd(!showAdd)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-accent text-white hover:bg-accent-light transition-colors">
              <Plus className="w-3.5 h-3.5" /> Add
            </button>
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-center gap-2">
            <div className="flex items-center rounded-lg bg-background border border-border/50 overflow-hidden text-xs">
              {(["month", "year"] as const).map((m) => (
                <button key={m} onClick={() => setViewMode(m)}
                  className={`px-3 py-1.5 transition-colors ${viewMode === m ? "bg-accent text-white" : "text-foreground/60 hover:text-foreground"}`}>
                  {m.charAt(0).toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <button onClick={prevPeriod} className="p-1.5 rounded-lg border border-border/40 hover:border-accent/40 text-foreground/50 hover:text-accent transition-colors">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm font-semibold text-foreground min-w-28 text-center">{periodLabel}</span>
              <button onClick={nextPeriod} className="p-1.5 rounded-lg border border-border/40 hover:border-accent/40 text-foreground/50 hover:text-accent transition-colors">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div aria-label={`Transaction coverage for ${year}`} className="grid grid-cols-6 gap-1.5 sm:grid-cols-12">
            {MONTHS.map((monthName, index) => {
              const monthNumber = index + 1;
              const transactionCount = monthCoverage[monthNumber] ?? 0;
              const hasTransactions = transactionCount > 0;
              const isCurrentMonth = year === new Date().getFullYear() && monthNumber === new Date().getMonth() + 1;
              const isSelected = viewMode === "month" && month === monthNumber;
              const status = [
                `${transactionCount} CSV transaction${transactionCount === 1 ? "" : "s"}`,
                isCurrentMonth ? "current month, still in progress" : "",
              ].filter(Boolean).join("; ");
              return (
                <button
                  key={monthName}
                  type="button"
                  onClick={() => { setMonth(monthNumber); setViewMode("month"); }}
                  aria-label={`${monthName} ${year}: ${status}`}
                  aria-pressed={isSelected}
                  title={`${monthName} ${year}: ${status}`}
                  className={`relative rounded-md border px-1 py-1.5 text-[10px] font-medium transition-colors ${
                    hasTransactions
                      ? "border-green/30 bg-green/10 text-green"
                      : isCurrentMonth
                        ? "border-yellow-500/30 bg-yellow-500/5 text-yellow-400"
                        : "border-border/30 text-foreground/40 hover:border-border/60 hover:text-foreground/70"
                  } ${isSelected ? "ring-1 ring-accent" : ""}`}
                >
                  {monthName.slice(0, 3)}
                  {isCurrentMonth && <span aria-hidden="true" className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-yellow-400" />}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[10px] text-foreground/45">
            <span className="inline-flex items-center gap-1"><span aria-hidden="true" className="h-2 w-2 rounded-sm bg-green" />CSV transactions imported</span>
            <span className="inline-flex items-center gap-1"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-yellow-400" />Current month in progress</span>
            {coverageLoading && <span>Loading coverage…</span>}
            {coverageError && <span role="status" className="text-yellow-400">Month coverage unavailable</span>}
          </div>
        </div>
      </div>

      {/* â"€â"€ Add form â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
      {showImport && (
        <div className="mb-5 rounded-xl border border-accent/20 bg-background p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Import bank or credit-card transactions</p>
              <p className="mt-1 text-[10px] text-foreground/40">We’ll match the filename or an Account/Card Number column when possible. Add a card’s last four digits to its name to match masked CSVs; otherwise choose the source manually. Duplicate rows are skipped.</p>
            </div>
            <button type="button" onClick={() => setShowImport(false)} className="text-foreground/40 hover:text-foreground"><X className="h-4 w-4" /></button>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="text-[10px] text-foreground/50">
              Account or card
              <select value={importSource} onChange={event => {
                setImportSource(event.target.value);
                setSourceAutoDetected(false);
                setSourceDetectionMessage(event.target.value ? "Source selected manually." : "");
              }} className="mt-1 w-full rounded-lg border border-border/50 bg-card px-2.5 py-2 text-xs text-foreground">
                <option value="">Choose a source…</option>
                {accounts.filter(account => account.type === "bank" || account.type === "cash").length > 0 && <optgroup label="Bank and cash accounts">{accounts.filter(account => account.type === "bank" || account.type === "cash").map(account => <option key={account.id} value={`account:${account.id}`}>{account.name}</option>)}</optgroup>}
                {creditCards.length > 0 && <optgroup label="Credit cards">{creditCards.map(card => <option key={card.id} value={`card:${card.id}`}>{card.name}</option>)}</optgroup>}
              </select>
            </label>
            <label className="text-[10px] text-foreground/50 sm:col-span-2">
              CSV file
              <input type="file" accept=".csv,text/csv" onChange={event => void handleImportFile(event.target.files?.[0])} className="mt-1 block w-full rounded-lg border border-border/50 bg-card px-2.5 py-1.5 text-xs text-foreground file:mr-2 file:rounded file:border-0 file:bg-accent/10 file:px-2 file:py-1 file:text-xs file:text-accent-light" />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/30 bg-card/40 p-3">
            <div>
              <p className="text-xs font-semibold text-foreground">Old Teller transactions</p>
              <p className="mt-1 text-[10px] text-foreground/45">
                {tellerCountLoading
                  ? "Checking for transactions linked to Teller…"
                  : tellerCountError
                    ? "Could not load the Teller transaction count."
                    : `${tellerTransactionCount ?? 0} transactions still have a Teller transaction ID, including ones no longer linked to an account.`}
              </p>
            </div>
            {(tellerTransactionCount ?? 0) > 0 && (
              <button
                type="button"
                disabled={tellerCountLoading || tellerCountError || deletingTellerTransactions}
                onClick={() => setDeleteTellerConfirmation(true)}
                className="rounded-lg border border-red/30 px-2.5 py-1.5 text-[10px] font-semibold text-red transition-colors hover:bg-red/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Delete {tellerTransactionCount} Teller transactions
              </button>
            )}
          </div>
          <div className="mt-3 rounded-lg border border-border/30 bg-card/40 p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-xs font-semibold text-foreground">
                {importSource
                  ? `Saved CSV coverage · ${selectedImportSourceName ?? "Selected source"} · ${year}`
                  : `Saved CSV coverage · Choose an account or card · ${year}`}
              </p>
              {importSource && activeSourceCoverage?.latestAddedAt && (
                <p className="text-[10px] text-foreground/50">
                  Latest transaction added {new Date(activeSourceCoverage.latestAddedAt).toLocaleString()}
                </p>
              )}
            </div>
            <div className="mt-2 grid grid-cols-6 gap-1 sm:grid-cols-12">
              {MONTHS.map((monthName, index) => {
                const count = activeSourceCoverage?.monthCounts[index + 1] ?? 0;
                const isCurrentMonth = year === new Date().getFullYear() && index === new Date().getMonth();
                const coverageReady = Boolean(importSource && activeSourceCoverage && !sourceCoverageLoading && !sourceCoverageError);
                return (
                  <div
                    key={monthName}
                    title={importSource && coverageReady ? `${monthName} ${year}: ${count} CSV transaction${count === 1 ? "" : "s"} for this source` : `${monthName} ${year}`}
                    className={`rounded-md border px-1 py-1.5 text-center text-[10px] ${
                      !importSource
                        ? "border-border/30 text-foreground/35"
                        : count > 0
                          ? "border-green/30 bg-green/10 text-green"
                          : isCurrentMonth
                            ? "border-yellow-500/30 bg-yellow-500/5 text-yellow-400"
                            : "border-border/30 text-foreground/35"
                    }`}
                  >
                    <span className="block">{monthName.slice(0, 3)}</span>
                    <span className="block font-semibold">{coverageReady ? count : "—"}</span>
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <p className="text-[10px] text-foreground/40">
                {importSource
                  ? "Counts are saved CSV transactions by transaction date. The latest-added time is when the newest transaction was first saved; skipped duplicates do not update it."
                  : "Choose a source to load its saved month coverage. The counts update when you switch accounts or cards."}
              </p>
              {sourceCoverageLoading && <p role="status" className="text-[10px] text-foreground/50">Loading coverage…</p>}
              {sourceCoverageError && <p role="status" className="text-[10px] text-yellow-400">Could not load coverage.</p>}
            </div>
            {importSource && activeSourceCoverage && activeSourceCoverage.totalTransactionCount > 0 && (
              <button
                type="button"
                disabled={sourceCoverageLoading || deletingSource}
                onClick={() => {
                  if ((importSourceKind === "account" || importSourceKind === "card") && importSourceId) {
                    setDeleteSource({
                      kind: importSourceKind,
                      id: importSourceId,
                      name: selectedImportSourceName ?? "selected source",
                      count: activeSourceCoverage.totalTransactionCount,
                    });
                  }
                }}
                className="mt-3 rounded-lg border border-red/30 px-2.5 py-1.5 text-[10px] font-semibold text-red transition-colors hover:bg-red/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Delete all {activeSourceCoverage.totalTransactionCount} transactions for this source
              </button>
            )}
          </div>
          {sourceDetectionMessage && (
            <p role="status" className={`mt-2 text-[10px] ${sourceAutoDetected ? "text-green" : "text-foreground/45"}`}>
              {sourceDetectionMessage}
            </p>
          )}
          {importError && <p className="mt-3 rounded-lg border border-red/20 bg-red/5 px-3 py-2 text-xs text-red">{importError}</p>}
          {importRows.length > 0 && (
            <div className="mt-3 rounded-lg border border-border/30 bg-card/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-foreground">{importRows.length} rows ready</span>
                <span className="text-foreground/45">{formatCurrency(importRows.reduce((sum, row) => sum + (row.transaction_type === "income" ? -row.amount : row.amount), 0))} net imported</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {importPreviewMonths.map(({ key, label, count }) => (
                  <span key={key} className="rounded-md border border-accent/20 bg-accent/5 px-2 py-1 text-[10px] text-foreground/65">
                    {label} · {count} row{count === 1 ? "" : "s"} in file
                  </span>
                ))}
              </div>
              <div className="mt-2 max-h-28 overflow-auto space-y-1">
                {importRows.slice(0, 5).map((row, index) => <div key={`${row.date}-${index}`} className="flex justify-between gap-3 text-[10px] text-foreground/55"><span>{row.date} · {row.name}</span><span className={row.transaction_type === "income" ? "text-green" : "text-red"}>{row.transaction_type === "income" ? "+" : "−"}{formatCurrency(Math.abs(row.amount))}</span></div>)}
                {importRows.length > 5 && <p className="text-[10px] text-foreground/30">and {importRows.length - 5} more…</p>}
              </div>
              <button type="button" onClick={() => void handleImport()} disabled={!importSource || importing}
                className="mt-3 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">
                {importing ? "Importing…" : "Import transactions"}
              </button>
            </div>
          )}
        </div>
      )}
      {showAdd && (
        <div className="mb-5 p-4 rounded-xl bg-background border border-accent/20">
          <p className="text-sm font-semibold text-foreground mb-3">Add transaction</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
            <div className="col-span-2 sm:col-span-1">
              <label className="text-foreground/50 block mb-1">Description *</label>
              <input type="text" value={addForm.name} onChange={e => setAddForm({...addForm, name: e.target.value})} placeholder="e.g. Starbucks"
                className="w-full bg-card border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" />
            </div>
            <div>
              <label className="text-foreground/50 block mb-1">Amount *</label>
              <input type="number" step="0.01" value={addForm.amount} onChange={e => setAddForm({...addForm, amount: e.target.value})} placeholder="0.00"
                className="w-full bg-card border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" />
            </div>
            <div>
              <label className="text-foreground/50 block mb-1">Date</label>
              <input type="date" value={addForm.date} onChange={e => setAddForm({...addForm, date: e.target.value})}
                className="w-full bg-card border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" />
            </div>
            <div>
              <label className="text-foreground/50 block mb-1">Type</label>
              <select value={addForm.transaction_type} onChange={e => setAddForm({...addForm, transaction_type: e.target.value as AddForm["transaction_type"]})}
                className="w-full bg-card border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent">
                <option value="expense">Expense</option>
                <option value="income">Income</option>
                <option value="transfer">Transfer</option>
              </select>
            </div>
            <div>
              <label className="text-foreground/50 block mb-1">Category</label>
              <select value={addForm.category} onChange={e => setAddForm({...addForm, category: e.target.value})}
                className="w-full bg-card border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent">
                {Object.entries(CATEGORIES).map(([key, m]) => (
                  <option key={key} value={key}>{m.emoji} {m.label}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className="text-foreground/50 block mb-1">Notes</label>
              <input type="text" value={addForm.notes} onChange={e => setAddForm({...addForm, notes: e.target.value})} placeholder="Optional"
                className="w-full bg-card border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" />
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={handleAdd} disabled={saving || !addForm.name.trim() || !addForm.amount}
              className="px-4 py-1.5 bg-accent text-white rounded-lg text-xs hover:bg-accent-light disabled:opacity-40 transition-colors">
              {saving ? "Saving…" : "Save"}
            </button>
            <button onClick={() => { setShowAdd(false); setAddForm(emptyForm); }}
              className="px-3 py-1.5 text-foreground/50 hover:text-foreground text-xs transition-colors">Cancel</button>
          </div>
        </div>
      )}

      {/* â"€â"€ Summary cards â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
      {summary && (
        <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-6">
          <div className="rounded-xl p-2.5 sm:p-4 bg-green-500/10 border border-green-500/20">
            <div className="flex items-center gap-1.5 mb-1">
              <TrendingUp className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-green-400" />
              <span className="text-[10px] sm:text-xs text-foreground/50">Income</span>
            </div>
            <p className="text-sm sm:text-lg font-bold text-green-400 tabular-nums">{formatCurrency(summary.totalIncome)}</p>
          </div>
          <div className="rounded-xl p-2.5 sm:p-4 bg-red-500/10 border border-red-500/20">
            <div className="flex items-center gap-1.5 mb-1">
              <TrendingDown className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-red-400" />
              <span className="text-[10px] sm:text-xs text-foreground/50">Expenses</span>
            </div>
            <p className="text-sm sm:text-lg font-bold text-red-400 tabular-nums">{formatCurrency(summary.totalExpenses)}</p>
          </div>
          <div className={`rounded-xl p-2.5 sm:p-4 border ${summary.net >= 0 ? "bg-accent/10 border-accent/20" : "bg-orange-500/10 border-orange-500/20"}`}>
            <div className="flex items-center gap-1.5 mb-1">
              <Minus className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-foreground/50" />
              <span className="text-[10px] sm:text-xs text-foreground/50">Net</span>
            </div>
            <p className={`text-sm sm:text-lg font-bold ${summary.net >= 0 ? "text-accent" : "text-orange-400"}`}>
              {summary.net >= 0 ? "+" : ""}{formatCurrency(summary.net)}
            </p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-16 space-y-2"><span className="text-2xl animate-bounce inline-block">🫘</span><p className="text-foreground/30 text-sm">Loading transactions...</p></div>
      ) : transactions.length === 0 ? (
        <div className="rounded-2xl border border-border/30 p-16 text-center space-y-2">
          <div className="text-4xl mb-3">🫘</div>
          <p className="text-foreground/50 font-medium">No beans to count yet</p>
          <p className="text-foreground/30 text-sm">Sync your bank via Teller or plant your first bean manually</p>
        </div>
      ) : (
        <div className="space-y-4">

          {/* â"€â"€ Donut chart (full width) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
          <div className="flex flex-col items-center gap-4">
            <div className="w-44 h-44 sm:w-56 sm:h-56">
              <SpendingDonut
                segments={donutSegments}
                total={donutTotal}
                highlightedCat={hoveredCat}
                onHover={setHoveredCat}
              />
            </div>
            {/* Donut legend */}
            <div className="w-full flex flex-wrap justify-center gap-1">
              {donutSegments.map(seg => {
                const pct = donutTotal > 0 ? Math.round((seg.amount / donutTotal) * 100) : 0;
                const isActive = catFilter === seg.category;
                return (
                  <button
                    key={seg.category}
                    type="button"
                    onMouseEnter={() => setHoveredCat(seg.category)}
                    onMouseLeave={() => setHoveredCat(null)}
                    onClick={() => handleDonutClick(seg.category)}
                    className={"flex items-center gap-1.5 rounded-lg px-2.5 py-1 transition-all text-xs " + (isActive ? "bg-accent/10 ring-1 ring-accent/20" : hoveredCat === seg.category ? "bg-card-hover" : "hover:bg-card/60")}
                  >
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
                    <span className="truncate text-foreground/70">{seg.emoji} {seg.label}</span>
                    <span className="text-foreground/35 shrink-0 tabular-nums">{pct}%</span>
                  </button>
                );
              })}
              {catFilter && (
                <button onClick={() => setCatFilter(null)} className="text-xs text-accent/60 hover:text-accent px-2.5 py-1 transition-colors">
                  Clear filter ×
                </button>
              )}
            </div>
          </div>

          {/* â"€â"€ Category accordion + transaction list â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
          <div className="min-w-0 space-y-3">

            {/* Type filter tabs */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <SlidersHorizontal className="w-3.5 h-3.5 text-foreground/30 shrink-0" />
              {(["all", "expense", "income", "transfer"] as const).map(t => {
                const labels: Record<string, string> = { all: "All", expense: "💸 Expenses", income: "💰 Income", transfer: "🔄 Transfers" };
                const counts: Record<string, number> = {
                  all: transactions.length,
                  expense:  transactions.filter(x => x.transaction_type === "expense").length,
                  income:   transactions.filter(x => x.transaction_type === "income").length,
                  transfer: transactions.filter(x => x.transaction_type === "transfer").length,
                };
                return (
                  <button key={t} onClick={() => setTypeFilter(t)}
                    className={"px-3 py-1 rounded-xl text-xs font-medium transition-all border " + (typeFilter === t ? "bg-accent/15 text-accent border-accent/30" : "bg-background border-border/30 text-foreground/40 hover:text-foreground/70 hover:border-border/60")}
                  >
                    {labels[t]}
                    {counts[t] > 0 && <span className="ml-1.5 opacity-50 tabular-nums">{counts[t]}</span>}
                  </button>
                );
              })}
            </div>

            {/* Search + Advanced filters */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/30" />
                  <input
                    type="text"
                    placeholder="Search name, merchant, notes, account, category..."
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    className="w-full bg-background border border-border/50 rounded-xl pl-10 pr-9 py-2 text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-accent/50"
                  />
                  {query && (
                    <button onClick={() => setQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground/30 hover:text-foreground/70 transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <button
                  onClick={() => setShowAdvanced(v => !v)}
                  className={"p-2 rounded-xl border transition-all " + (showAdvanced || minAmount || maxAmount || dateFrom || dateTo || recurringOnly ? "bg-accent/10 border-accent/30 text-accent" : "border-border/40 text-foreground/40 hover:text-foreground/60")}
                  title="Advanced filters"
                >
                  <Filter className="w-4 h-4" />
                </button>
              </div>

              {/* Advanced filter panel */}
              {showAdvanced && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 rounded-xl bg-background/80 border border-border/30">
                  <div>
                    <label className="text-[10px] text-foreground/40 block mb-1">Min amount</label>
                    <input type="number" step="0.01" value={minAmount} onChange={e => setMinAmount(e.target.value)} placeholder="0.00"
                      className="w-full bg-card border border-border/40 rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:border-accent/50" />
                  </div>
                  <div>
                    <label className="text-[10px] text-foreground/40 block mb-1">Max amount</label>
                    <input type="number" step="0.01" value={maxAmount} onChange={e => setMaxAmount(e.target.value)} placeholder="0.00"
                      className="w-full bg-card border border-border/40 rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:border-accent/50" />
                  </div>
                  <div>
                    <label className="text-[10px] text-foreground/40 block mb-1">From date</label>
                    <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                      className="w-full bg-card border border-border/40 rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:border-accent/50" />
                  </div>
                  <div>
                    <label className="text-[10px] text-foreground/40 block mb-1">To date</label>
                    <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                      className="w-full bg-card border border-border/40 rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:border-accent/50" />
                  </div>
                  <div className="col-span-2 sm:col-span-4 flex items-center justify-between pt-1">
                    <button
                      onClick={() => setRecurringOnly(v => !v)}
                      className={"flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all border " + (recurringOnly ? "bg-purple-500/15 text-purple-400 border-purple-500/30" : "bg-background border-border/30 text-foreground/40 hover:text-foreground/60")}
                    >
                      <Repeat className="w-3 h-3" /> Recurring only
                    </button>
                    {(minAmount || maxAmount || dateFrom || dateTo || recurringOnly) && (
                      <button onClick={() => { setMinAmount(""); setMaxAmount(""); setDateFrom(""); setDateTo(""); setRecurringOnly(false); }}
                        className="text-xs text-accent/60 hover:text-accent transition-colors">
                        Clear filters
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Active category chip */}
            {catFilter && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-foreground/40">Category:</span>
                <button
                  onClick={() => setCatFilter(null)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-colors"
                >
                  {getCategoryMeta(catFilter).emoji} {getCategoryMeta(catFilter).label}
                  <X className="w-3 h-3 opacity-70" />
                </button>
              </div>
            )}

            {/* Results */}
            {filtered.length === 0 ? (
              <div className="py-10 text-center space-y-2">
                <p className="text-foreground/30 text-sm">No transactions match your filters</p>
                <button
                  onClick={() => { setQuery(""); setTypeFilter("all"); setCatFilter(null); setMinAmount(""); setMaxAmount(""); setDateFrom(""); setDateTo(""); setRecurringOnly(false); }}
                  className="text-xs text-accent hover:underline transition-colors"
                >Clear all filters</button>
              </div>
            ) : (query.trim() || catFilter || minAmount || maxAmount || dateFrom || dateTo || recurringOnly) ? (
              /* Flat list when searching or category-filtered */
              <div className="rounded-xl border border-border/30 bg-card/40 overflow-hidden">
                <div className="px-4 py-2 border-b border-border/20 flex items-center justify-between">
                  <span className="text-xs text-foreground/40">{filtered.length} result{filtered.length !== 1 ? "s" : ""}</span>
                  <span className="text-xs text-foreground/40 tabular-nums">
                    {formatCurrency(filtered.filter(t => t.transaction_type === "expense").reduce((s, t) => s + Math.abs(t.amount), 0))} spent
                  </span>
                </div>
                <div className="divide-y-0">
                  {filtered.map(tx => (
                    <TxRow key={tx.id} tx={tx} onDelete={handleDelete} onReclassify={handleReclassify} onClick={() => setSelectedTx(tx)} isRecurring={recurringIds.has(tx.id)} />
                  ))}
                </div>
              </div>
            ) : (
              /* Category accordion (default view) */
              <div className="space-y-1.5">
                {grouped.map(({ cat, meta, txs, total: catTotal }) => {
                  const isOpen = openCats.has(cat);
                  const isHighlighted = hoveredCat === cat;
                  const pct = donutTotal > 0 && meta.type === "expense"
                    ? Math.round((catTotal / donutTotal) * 100) : null;
                  return (
                    <div
                      key={cat}
                      className={"rounded-xl border transition-all overflow-hidden " + (isHighlighted ? "border-accent/30 bg-card-hover" : "border-border/30 bg-card/40")}
                      onMouseEnter={() => setHoveredCat(cat)}
                      onMouseLeave={() => setHoveredCat(null)}
                    >
                      <button
                        type="button"
                        onClick={() => toggleCat(cat)}
                        className="w-full flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 text-left hover:bg-background/30 transition-colors"
                      >
                        <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl flex items-center justify-center text-sm sm:text-base shrink-0"
                          style={{ backgroundColor: meta.color + "22" }}>
                          {meta.emoji}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs sm:text-sm font-semibold text-foreground">{meta.label}</span>
                            <div className="flex items-center gap-1.5 sm:gap-2">
                              <span className="text-[10px] sm:text-xs text-foreground/35 hidden sm:inline">{txs.length} txn{txs.length !== 1 ? "s" : ""}</span>
                              <span className={"text-xs sm:text-sm font-bold tabular-nums " + (meta.type === "income" ? "text-green-400" : "text-foreground/90")}>
                                {meta.type === "income" ? "+" : ""}{formatCurrency(catTotal)}
                              </span>
                              {pct !== null && (
                                <span className="text-[10px] sm:text-xs text-foreground/30 w-7 sm:w-8 text-right tabular-nums">{pct}%</span>
                              )}
                            </div>
                          </div>
                          {meta.type === "expense" && donutTotal > 0 && (
                            <div className="h-1 rounded-full bg-background overflow-hidden">
                              <div className="h-full rounded-full transition-all duration-500"
                                style={{ width: (pct ?? 0) + "%", backgroundColor: meta.color }} />
                            </div>
                          )}
                        </div>
                        <ChevronDown className={"w-4 h-4 text-foreground/30 shrink-0 transition-transform duration-200 " + (isOpen ? "rotate-180" : "")} />
                      </button>
                      {isOpen && (
                        <div className="bg-background/40 pb-1">
                          {txs.map(tx => (
                            <TxRow key={tx.id} tx={tx} onDelete={handleDelete} onReclassify={handleReclassify} onClick={() => setSelectedTx(tx)} isRecurring={recurringIds.has(tx.id)} />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <p className="text-center text-xs text-foreground/20 pt-1">
              {filtered.length === transactions.length
                ? `${transactions.length} transaction${transactions.length !== 1 ? "s" : ""} · ${grouped.length} ${grouped.length !== 1 ? "categories" : "category"}`
                : `${filtered.length} of ${transactions.length} shown`
              }
            </p>
          </div>
        </div>
      )}
      {selectedTx && (
        <TransactionDetailPanel
          tx={selectedTx}
          onClose={() => setSelectedTx(null)}
          onSave={handlePatch}
          onIgnore={handleIgnore}
          onSplit={handleSplit}
          onDelete={id => { setDeleteId(id); setSelectedTx(null); }}
        />
      )}
      <ConfirmDialog
        open={deleteId !== null}
        title="Delete transaction?"
        description="This will permanently remove this transaction."
        confirmLabel="Delete"
        onCancel={() => setDeleteId(null)}
        onConfirm={() => { const id = deleteId; setDeleteId(null); if (id) void handleDelete(id); }}
      />
      <ConfirmDialog
        open={deleteSource !== null}
        title={`Delete transactions from ${deleteSource?.name ?? "this source"}?`}
        description={`This permanently deletes ${deleteSource?.count ?? 0} transactions linked to this account or card, including CSV imports, synced transactions, and manual entries. The account/card itself will not be deleted. This action cannot be undone.`}
        confirmLabel={deletingSource ? "Deleting…" : "Delete all transactions"}
        onCancel={() => { if (!deletingSource) setDeleteSource(null); }}
        onConfirm={() => { void handleDeleteSourceTransactions(); }}
      />
      <ConfirmDialog
        open={deleteTellerConfirmation}
        title="Delete old Teller transactions?"
        description={`This permanently deletes all ${tellerTransactionCount ?? 0} transactions with a Teller transaction ID, including orphaned transactions whose account was deleted. It will not delete CSV-imported or manual transactions unless they also have a Teller transaction ID. This action cannot be undone.`}
        confirmLabel={deletingTellerTransactions ? "Deleting…" : "Delete Teller transactions"}
        onCancel={() => { if (!deletingTellerTransactions) setDeleteTellerConfirmation(false); }}
        onConfirm={() => { void handleDeleteTellerTransactions(); }}
      />
    </div>
  );
}