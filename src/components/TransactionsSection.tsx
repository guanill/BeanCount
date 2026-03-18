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
} from "lucide-react";
import { Transaction, TransactionSummary } from "@/lib/types";
import { CATEGORIES, getCategoryMeta } from "@/lib/categories";
import { formatCurrency } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import {
  getTransactions as fetchTransactionsFromSupabase,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  splitTransaction,
} from "@/lib/supabase/queries";
import { callEdgeFunction } from "@/lib/supabase/functions";

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

function formatDate(d: string) {
  const [y, m, day] = d.split("-");
  return `${MONTHS[parseInt(m) - 1].slice(0, 3)} ${parseInt(day)}, ${y}`;
}

/* â"€â"€â"€ Donut chart â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */
interface DonutSegment { category: string; label: string; color: string; emoji: string; amount: number; }

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

/* ─── Transaction row ──────────────────────────────────────────────────────── */
function TxRow({
  tx,
  onDelete,
  onReclassify,
  onClick,
}: {
  tx: Transaction;
  onDelete: (id: string) => void;
  onReclassify: (id: string, newCat: string) => void;
  onClick: () => void;
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
          <span className="text-[10px] sm:text-xs px-1.5 py-0.5 rounded-full hidden sm:inline" style={{ backgroundColor: meta.color + "20", color: meta.color }}>
            {meta.label}
          </span>
          {tx.account_name && <span className="text-[10px] sm:text-xs text-foreground/30 truncate max-w-24 sm:max-w-40">{tx.account_name}</span>}
          {isIgnored && <span className="flex items-center gap-0.5 text-[10px] sm:text-xs text-foreground/30"><EyeOff className="w-2.5 h-2.5" /> ignored</span>}
          {tx.is_manual && <span className="text-[10px] sm:text-xs text-foreground/25">manual</span>}
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
        <span className={`text-xs sm:text-sm font-bold ${isIgnored ? "line-through text-foreground/30" : isIncome ? "text-green-400" : "text-foreground/90"}`}>
          {isIncome ? "+" : "-"}{formatCurrency(displayAmt)}
        </span>
        {tx.is_manual && (
          <button onClick={() => onDelete(tx.id)} className="hidden group-hover:flex p-1 text-foreground/20 hover:text-red-400 transition-colors">
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
                <span className="text-foreground/30">·</span>
                <span>{tx.plaid_transaction_id ? "Plaid" : tx.teller_transaction_id ? "Teller" : "Manual"}</span>
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
  const now = new Date();
  const [year,     setYear]    = useState(now.getFullYear());
  const [month,    setMonth]   = useState(now.getMonth() + 1);
  const [viewMode, setViewMode] = useState<"month" | "year">("month");

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [summary,      setSummary]      = useState<TransactionSummary | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [syncing,  setSyncing]  = useState(false);
  const [syncMsg,  setSyncMsg]  = useState<string | null>(null);
  const [query,    setQuery]    = useState("");

  const [showAdd,  setShowAdd]  = useState(false);
  const [addForm,  setAddForm]  = useState<AddForm>(emptyForm);
  const [saving,   setSaving]   = useState(false);

  // Accordion: which categories are open
  const [openCats, setOpenCats] = useState<Set<string>>(new Set());
  // Donut hover
  const [hoveredCat, setHoveredCat] = useState<string | null>(null);
  // Client-side filters
  const [typeFilter, setTypeFilter] = useState<"all" | "expense" | "income" | "transfer">("all");
  const [catFilter,  setCatFilter]  = useState<string | null>(null);
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
    } catch (err) {
      console.error("Failed to fetch transactions:", err);
    } finally {
      setLoading(false);
    }
  }, [year, month, viewMode]);

  useEffect(() => { fetchTransactions(); }, [fetchTransactions]);

  /* â"€â"€ Group transactions by category (client-side) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */
  // Client-side filtered list: search + type + category filters
  const filtered = useMemo(() => {
    let list = transactions;
    if (typeFilter !== "all") list = list.filter(t => t.transaction_type === typeFilter);
    if (catFilter) list = list.filter(t => t.category === catFilter);
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(t =>
        t.name.toLowerCase().includes(q) ||
        (t.merchant_name?.toLowerCase() ?? "").includes(q)
      );
    }
    return [...list].sort((a, b) => b.date.localeCompare(a.date));
  }, [transactions, typeFilter, catFilter, query]);

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
      const data = await callEdgeFunction<{ added: number; message?: string }>("plaid-sync-transactions");
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

  async function handleDelete(id: string) {
    if (!confirm("Delete this transaction?")) return;
    const supabase = createClient();
    await deleteTransaction(supabase, id);
    fetchTransactions();
  }

  async function handleReclassify(id: string, newCategory: string) {
    const newMeta = getCategoryMeta(newCategory);
    const newType = newMeta.type;
    const supabase = createClient();
    await updateTransaction(supabase, id, { category: newCategory, transaction_type: newType });
    fetchTransactions();
  }

  async function handlePatch(id: string, updates: Record<string, string | number>) {
    const supabase = createClient();
    await updateTransaction(supabase, id, updates as any);
    await fetchTransactions();
    setSelectedTx(prev => prev?.id === id ? { ...prev, ...updates } as Transaction : prev);
  }

  async function handleIgnore(id: string, ignore: boolean) {
    const supabase = createClient();
    await updateTransaction(supabase, id, { is_ignored: ignore });
    await fetchTransactions();
    setSelectedTx(prev => prev?.id === id ? { ...prev, is_ignored: ignore } : prev);
  }

  async function handleSplit(id: string, a: SplitPart, b: SplitPart) {
    const supabase = createClient();
    await splitTransaction(
      supabase,
      id,
      { ...a, amount: parseFloat(a.amount) || 0 },
      { ...b, amount: parseFloat(b.amount) || 0 },
    );
    setSelectedTx(null);
    fetchTransactions();
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
            <button onClick={() => setShowAdd(!showAdd)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-accent text-white hover:bg-accent-light transition-colors">
              <Plus className="w-3.5 h-3.5" /> Add
            </button>
          </div>
        </div>
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
      </div>

      {/* â"€â"€ Add form â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
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
              {saving ? "Savingâ€¦" : "Save"}
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
        <div className="text-center py-16 text-foreground/30 text-sm">Loadingâ€¦</div>
      ) : transactions.length === 0 ? (
        <div className="rounded-2xl border border-border/30 p-16 text-center space-y-2">
          <div className="text-4xl mb-3">🏦</div>
          <p className="text-foreground/50 font-medium">No transactions yet</p>
          <p className="text-foreground/30 text-sm">Sync your bank via Teller or add one manually</p>
        </div>
      ) : (
        <div className="space-y-4 lg:space-y-0 lg:grid lg:grid-cols-[220px_1fr] lg:gap-6">

          {/* â"€â"€ Donut chart â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
          <div className="flex flex-row lg:flex-col items-center gap-4 pb-2 lg:pb-0">
            <div className="w-28 h-28 sm:w-36 sm:h-36 lg:w-44 lg:h-44 shrink-0">
              <SpendingDonut
                segments={donutSegments}
                total={donutTotal}
                highlightedCat={hoveredCat}
                onHover={setHoveredCat}
              />
            </div>
            {/* Donut legend - click to filter list */}
            <div className="flex-1 min-w-0 flex flex-row flex-wrap gap-1 lg:flex-col lg:w-full lg:space-y-1 lg:gap-0">
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
                    className={"w-full flex items-center gap-2 text-left rounded-lg px-2 py-1 transition-all text-xs " + (isActive ? "bg-accent/10 ring-1 ring-accent/20" : hoveredCat === seg.category ? "bg-card-hover" : "hover:bg-card/60")}
                  >
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
                    <span className="flex-1 truncate text-foreground/70">{seg.emoji} {seg.label}</span>
                    <span className="text-foreground/35 shrink-0 tabular-nums">{pct}%</span>
                  </button>
                );
              })}
              {catFilter && (
                <button onClick={() => setCatFilter(null)} className="w-full text-xs text-accent/60 hover:text-accent pt-0.5 transition-colors">
                  Clear filter ×
                </button>
              )}
            </div>
          </div>

          {/* â"€â"€ Category accordion â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
          {/* Right: type tabs + search + list */}
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

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/30" />
              <input
                type="text"
                placeholder="Search by name or merchant..."
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
                  onClick={() => { setQuery(""); setTypeFilter("all"); setCatFilter(null); }}
                  className="text-xs text-accent hover:underline transition-colors"
                >Clear all filters</button>
              </div>
            ) : (query.trim() || catFilter) ? (
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
                    <TxRow key={tx.id} tx={tx} onDelete={handleDelete} onReclassify={handleReclassify} onClick={() => setSelectedTx(tx)} />
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
                            <TxRow key={tx.id} tx={tx} onDelete={handleDelete} onReclassify={handleReclassify} onClick={() => setSelectedTx(tx)} />
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
          onDelete={id => { handleDelete(id); setSelectedTx(null); }}
        />
      )}
    </div>
  );
}