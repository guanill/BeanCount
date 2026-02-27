"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
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
} from "lucide-react";
import { Transaction, TransactionSummary } from "@/lib/types";
import { CATEGORIES, getCategoryMeta } from "@/lib/categories";
import { formatCurrency } from "@/lib/format";

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

function formatDate(d: string) {
  const [y, m, day] = d.split("-");
  return `${MONTHS[parseInt(m) - 1].slice(0, 3)} ${parseInt(day)}, ${y}`;
}

/* â”€â”€â”€ Donut chart â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
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

  // Build arc segments (pure – no mutation)
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

/* â”€â”€â”€ Transaction row with reclassify â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function TxRow({
  tx,
  onDelete,
  onReclassify,
}: {
  tx: Transaction;
  onDelete: (id: string) => void;
  onReclassify: (id: string, newCat: string) => void;
}) {
  const [reclassifying, setReclassifying] = useState(false);
  const meta       = getCategoryMeta(tx.category);
  const isIncome   = tx.transaction_type === "income";
  const displayAmt = Math.abs(tx.amount);

  return (
    <div className="group flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-background/60 transition-colors">
      {/* Emoji badge */}
      <div
        className="w-7 h-7 rounded-lg flex items-center justify-center text-sm shrink-0"
        style={{ backgroundColor: meta.color + "20" }}
      >
        {meta.emoji}
      </div>

      {/* Name + date + category pill */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{tx.merchant_name || tx.name}</p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="text-xs text-foreground/40">{formatDate(tx.date)}</span>

          {/* Category pill â€” click to reclassify */}
          {reclassifying ? (
            <select
              autoFocus
              defaultValue={tx.category}
              onBlur={() => setReclassifying(false)}
              onChange={(e) => { onReclassify(tx.id, e.target.value); setReclassifying(false); }}
              className="text-xs rounded-md bg-card border border-accent/40 text-foreground px-1.5 py-0.5 focus:outline-none cursor-pointer"
            >
              {Object.entries(CATEGORIES).map(([key, m]) => (
                <option key={key} value={key}>{m.emoji} {m.label}</option>
              ))}
            </select>
          ) : (
            <button
              type="button"
              onClick={() => setReclassifying(true)}
              title="Click to reclassify"
              className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full transition-colors hover:ring-1 hover:ring-accent/50"
              style={{ backgroundColor: meta.color + "20", color: meta.color }}
            >
              {meta.label}
              <Tag className="w-2.5 h-2.5 opacity-60" />
            </button>
          )}

          {tx.is_manual === 1 && <span className="text-xs text-foreground/25">manual</span>}
        </div>
      </div>

      {/* Amount + delete */}
      <div className="flex items-center gap-1.5 shrink-0">
        <span className={`text-sm font-bold ${isIncome ? "text-green-400" : "text-foreground/90"}`}>
          {isIncome ? "+" : "-"}{formatCurrency(displayAmt)}
        </span>
        {tx.is_manual === 1 && (
          <button
            onClick={() => onDelete(tx.id)}
            className="hidden group-hover:flex p-1 text-foreground/20 hover:text-red-400 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

/* â”€â”€â”€ Add form interface â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
interface AddForm {
  name: string; amount: string; date: string;
  category: string; transaction_type: "income" | "expense" | "transfer"; notes: string;
}
const emptyForm: AddForm = {
  name: "", amount: "", date: new Date().toISOString().slice(0, 10),
  category: "other", transaction_type: "expense", notes: "",
};

/* â”€â”€â”€ Main component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
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

  /* â”€â”€ Data fetching â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ year: String(year) });
      if (viewMode === "month") params.set("month", String(month));
      if (query) params.set("q", query);
      const res  = await fetch(`/api/transactions?${params}`);
      const data = await res.json();
      setTransactions(data.transactions ?? []);
      setSummary(data.summary ?? null);
    } finally {
      setLoading(false);
    }
  }, [year, month, viewMode, query]);

  useEffect(() => { fetchTransactions(); }, [fetchTransactions]);

  /* â”€â”€ Group transactions by category (client-side) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  const grouped = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    for (const tx of transactions) {
      const list = map.get(tx.category) ?? [];
      list.push(tx);
      map.set(tx.category, list);
    }
    // Sort groups by total spend descending
    return Array.from(map.entries())
      .map(([cat, txs]) => {
        const meta  = getCategoryMeta(cat);
        const total = txs.reduce((s, t) => s + Math.abs(t.amount), 0);
        return { cat, meta, txs, total };
      })
      .sort((a, b) => b.total - a.total);
  }, [transactions]);

  /* â”€â”€ Donut segments â€” expenses only â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  const donutSegments = useMemo((): DonutSegment[] => {
    return grouped
      .filter(g => g.meta.type === "expense")
      .map(g => ({ category: g.cat, label: g.meta.label, color: g.meta.color, emoji: g.meta.emoji, amount: g.total }));
  }, [grouped]);

  const donutTotal = donutSegments.reduce((s, d) => s + d.amount, 0);

  /* â”€â”€ Actions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  async function handleSyncTransactions() {
    setSyncing(true); setSyncMsg(null);
    try {
      const res  = await fetch("/api/teller/sync-transactions", { method: "POST" });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSyncMsg(`âœ“ ${data.added} new transactions`);
      fetchTransactions();
      setTimeout(() => setSyncMsg(null), 4000);
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  async function handleAdd() {
    if (!addForm.name.trim() || !addForm.amount) return;
    setSaving(true);
    try {
      await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...addForm,
          amount: addForm.transaction_type === "income"
            ? -Math.abs(parseFloat(addForm.amount))
            : Math.abs(parseFloat(addForm.amount)),
        }),
      });
      setAddForm(emptyForm); setShowAdd(false); fetchTransactions();
    } finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this transaction?")) return;
    await fetch(`/api/transactions/${id}`, { method: "DELETE" });
    fetchTransactions();
  }

  async function handleReclassify(id: string, newCategory: string) {
    const newMeta = getCategoryMeta(newCategory);
    const newType = newMeta.type;
    await fetch(`/api/transactions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: newCategory, transaction_type: newType }),
    });
    fetchTransactions();
  }

  function toggleCat(cat: string) {
    setOpenCats(prev => {
      const next = new Set(prev);
      if (next.has(cat)) { next.delete(cat); } else { next.add(cat); }
      return next;
    });
    // Also highlight donut segment
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

  /* â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  return (
    <div className="rounded-2xl border border-border/50 bg-card p-6 animate-slide-up">

      {/* â”€â”€ Header â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="text-xl font-bold text-foreground">Transactions</h2>
          <p className="text-sm text-foreground/40 mt-0.5">Spending &amp; income â€” auto-categorized</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
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
            <span className="text-sm font-semibold text-foreground min-w-32 text-center">{periodLabel}</span>
            <button onClick={nextPeriod} className="p-1.5 rounded-lg border border-border/40 hover:border-accent/40 text-foreground/50 hover:text-accent transition-colors">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <button onClick={handleSyncTransactions} disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-border/40 hover:border-accent/30 text-foreground/60 hover:text-accent transition-colors disabled:opacity-40">
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
            {syncMsg ?? (syncing ? "Syncing…" : "Sync Teller")}
          </button>
          <button onClick={() => setShowAdd(!showAdd)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-accent text-white hover:bg-accent-light transition-colors">
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
      </div>

      {/* â”€â”€ Add form â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
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

      {/* â”€â”€ Summary cards â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {summary && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="rounded-xl p-4 bg-green-500/10 border border-green-500/20">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-green-400" />
              <span className="text-xs text-foreground/50">Income</span>
            </div>
            <p className="text-lg font-bold text-green-400">{formatCurrency(summary.totalIncome)}</p>
          </div>
          <div className="rounded-xl p-4 bg-red-500/10 border border-red-500/20">
            <div className="flex items-center gap-2 mb-1">
              <TrendingDown className="w-4 h-4 text-red-400" />
              <span className="text-xs text-foreground/50">Expenses</span>
            </div>
            <p className="text-lg font-bold text-red-400">{formatCurrency(summary.totalExpenses)}</p>
          </div>
          <div className={`rounded-xl p-4 border ${summary.net >= 0 ? "bg-accent/10 border-accent/20" : "bg-orange-500/10 border-orange-500/20"}`}>
            <div className="flex items-center gap-2 mb-1">
              <Minus className="w-4 h-4 text-foreground/50" />
              <span className="text-xs text-foreground/50">Net</span>
            </div>
            <p className={`text-lg font-bold ${summary.net >= 0 ? "text-accent" : "text-orange-400"}`}>
              {summary.net >= 0 ? "+" : ""}{formatCurrency(summary.net)}
            </p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-16 text-foreground/30 text-sm">Loadingâ€¦</div>
      ) : transactions.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-foreground/30 text-sm">No transactions found</p>
          <p className="text-foreground/20 text-xs mt-1">Connect a bank via Teller or add one manually</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-6">

          {/* â”€â”€ Donut chart â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
          <div className="flex flex-col items-center gap-4">
            <div className="w-44 h-44">
              <SpendingDonut
                segments={donutSegments}
                total={donutTotal}
                highlightedCat={hoveredCat}
                onHover={setHoveredCat}
              />
            </div>
            {/* Donut legend */}
            <div className="w-full space-y-1.5">
              {donutSegments.slice(0, 7).map(seg => {
                const pct = donutTotal > 0 ? Math.round((seg.amount / donutTotal) * 100) : 0;
                return (
                  <button
                    key={seg.category}
                    type="button"
                    onMouseEnter={() => setHoveredCat(seg.category)}
                    onMouseLeave={() => setHoveredCat(null)}
                    onClick={() => toggleCat(seg.category)}
                    className={`w-full flex items-center gap-2 text-left rounded-lg px-2 py-1 transition-colors text-xs
                      ${hoveredCat === seg.category ? "bg-card-hover" : "hover:bg-card/60"}`}
                  >
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
                    <span className="flex-1 truncate text-foreground/70">{seg.emoji} {seg.label}</span>
                    <span className="text-foreground/40 shrink-0">{pct}%</span>
                  </button>
                );
              })}
              {donutSegments.length > 7 && (
                <p className="text-xs text-foreground/30 text-center">+{donutSegments.length - 7} more</p>
              )}
            </div>
          </div>

          {/* â”€â”€ Category accordion â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
          <div className="min-w-0">
            {/* Search */}
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/30" />
              <input
                type="text"
                placeholder="Search transactionsâ€¦"
                value={query}
                onChange={e => setQuery(e.target.value)}
                className="w-full bg-background border border-border/50 rounded-xl pl-10 pr-4 py-2 text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-accent/50"
              />
            </div>

            <div className="space-y-2">
              {grouped.map(({ cat, meta, txs, total: catTotal }) => {
                const isOpen = openCats.has(cat);
                const isHighlighted = hoveredCat === cat;
                const pct = donutTotal > 0 && meta.type === "expense"
                  ? Math.round((catTotal / donutTotal) * 100) : null;
                return (
                  <div
                    key={cat}
                    className={`rounded-xl border transition-colors overflow-hidden
                      ${isHighlighted ? "border-accent/30 bg-card-hover" : "border-border/40 bg-card/40"}`}
                    onMouseEnter={() => setHoveredCat(cat)}
                    onMouseLeave={() => setHoveredCat(null)}
                  >
                    {/* Category header row */}
                    <button
                      type="button"
                      onClick={() => toggleCat(cat)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-card-hover/50 transition-colors"
                    >
                      {/* Color dot + emoji */}
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-base shrink-0"
                        style={{ backgroundColor: meta.color + "22" }}
                      >
                        {meta.emoji}
                      </div>

                      {/* Label + mini bar */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-semibold text-foreground">{meta.label}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-foreground/40">{txs.length} txn{txs.length !== 1 ? "s" : ""}</span>
                            <span
                              className={`text-sm font-bold ${meta.type === "income" ? "text-green-400" : "text-foreground/90"}`}
                            >
                              {meta.type === "income" ? "+" : ""}{formatCurrency(catTotal)}
                            </span>
                            {pct !== null && (
                              <span className="text-xs text-foreground/30 w-8 text-right">{pct}%</span>
                            )}
                          </div>
                        </div>
                        {/* Thin progress bar */}
                        {meta.type === "expense" && donutTotal > 0 && (
                          <div className="h-1 rounded-full bg-background overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{ width: `${Math.round((catTotal / donutTotal) * 100)}%`, backgroundColor: meta.color }}
                            />
                          </div>
                        )}
                      </div>

                      {/* Chevron */}
                      <ChevronDown
                        className={`w-4 h-4 text-foreground/30 shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                      />
                    </button>

                    {/* Expanded transaction list */}
                    {isOpen && (
                      <div className="border-t border-border/30 bg-background/40 px-2 py-2 space-y-0.5">
                        {txs.map(tx => (
                          <TxRow
                            key={tx.id}
                            tx={tx}
                            onDelete={handleDelete}
                            onReclassify={handleReclassify}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <p className="text-center text-xs text-foreground/20 mt-4">
              {transactions.length} transaction{transactions.length !== 1 ? "s" : ""} Â· {grouped.length} categor{grouped.length !== 1 ? "ies" : "y"}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
