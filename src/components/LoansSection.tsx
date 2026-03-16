"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Plus, Pencil, Trash2, TrendingDown,
  Zap, ChevronDown, ChevronUp,
  CheckCircle2, SlidersHorizontal, Flame, Target,
} from "lucide-react";
import { Loan } from "@/lib/types";
import { formatCurrency } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { getLoans, createLoan, updateLoan, deleteLoan } from "@/lib/supabase/queries";

// ─── Loan type metadata ────────────────────────────────────────────────────────
const LOAN_TYPES = [
  { value: "mortgage",   label: "Mortgage",          emoji: "🏠", accent: "sky"    },
  { value: "auto",       label: "Auto Loan",         emoji: "🚗", accent: "amber"  },
  { value: "student",    label: "Student Loan",      emoji: "🎓", accent: "violet" },
  { value: "personal",   label: "Personal Loan",     emoji: "💼", accent: "indigo" },
  { value: "medical",    label: "Medical",           emoji: "🏥", accent: "rose"   },
  { value: "business",   label: "Business",          emoji: "🏢", accent: "emerald"},
  { value: "short_term", label: "Short-Term / BNPL", emoji: "🛍️", accent: "cyan"   },
  { value: "other",      label: "Other",             emoji: "📌", accent: "slate"  },
];

const TYPE_COLORS: Record<string, { bg: string; border: string; text: string; ring: string }> = {
  mortgage:   { bg: "bg-sky-500/10",     border: "border-sky-500/20",     text: "text-sky-400",     ring: "#38bdf8" },
  auto:       { bg: "bg-amber-500/10",   border: "border-amber-500/20",   text: "text-amber-400",   ring: "#fbbf24" },
  student:    { bg: "bg-violet-500/10",  border: "border-violet-500/20",  text: "text-violet-400",  ring: "#a78bfa" },
  personal:   { bg: "bg-indigo-500/10",  border: "border-indigo-500/20",  text: "text-indigo-400",  ring: "#818cf8" },
  medical:    { bg: "bg-rose-500/10",    border: "border-rose-500/20",    text: "text-rose-400",    ring: "#fb7185" },
  business:   { bg: "bg-emerald-500/10", border: "border-emerald-500/20", text: "text-emerald-400", ring: "#34d399" },
  short_term: { bg: "bg-cyan-500/10",    border: "border-cyan-500/20",    text: "text-cyan-400",    ring: "#22d3ee" },
  other:      { bg: "bg-slate-500/10",   border: "border-slate-500/20",   text: "text-slate-400",   ring: "#94a3b8" },
};

function getLoanMeta(type: string) {
  return LOAN_TYPES.find(t => t.value === type) ?? LOAN_TYPES[LOAN_TYPES.length - 1];
}
function getTypeColors(type: string) {
  return TYPE_COLORS[type] ?? TYPE_COLORS.other;
}

const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ─── Amortization math ─────────────────────────────────────────────────────────
interface AmortRow {
  month: number;
  payment: number;
  principal: number;
  interest: number;
  balance: number;
  deferred?: boolean;
}

function buildAmortSchedule(
  balance: number,
  annualRate: number,
  monthlyPayment: number,
  maxMonths = 600,
  deferralMonths = 0,
  subsidized = false,
): AmortRow[] {
  if (balance <= 0 || monthlyPayment <= 0) return [];
  const r = annualRate / 100 / 12;
  const rows: AmortRow[] = [];
  let bal = balance;

  for (let m = 1; m <= deferralMonths; m++) {
    const interest = (!subsidized && r > 0) ? bal * r : 0;
    bal += interest;
    rows.push({ month: m, payment: 0, principal: 0, interest, balance: bal, deferred: true });
  }

  for (let m = 1; m <= maxMonths; m++) {
    const interest      = r > 0 ? bal * r : 0;
    const actualPay     = Math.min(Math.max(monthlyPayment, interest + 0.01), bal + interest);
    const principal     = actualPay - interest;
    bal                 = Math.max(bal - principal, 0);
    rows.push({ month: deferralMonths + m, payment: actualPay, principal, interest, balance: bal });
    if (bal <= 0.005) break;
  }
  return rows;
}

function totalInterest(rows: AmortRow[]) {
  return rows.reduce((s, r) => s + r.interest, 0);
}

function payoffLabel(months: number) {
  if (months <= 0) return "Paid off";
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m}mo`;
  if (m === 0) return `${y}yr`;
  return `${y}yr ${m}mo`;
}

/** Returns "Apr 2029" style payoff date from months remaining */
function payoffDate(months: number): string {
  if (months <= 0) return "Paid off";
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + months);
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

// ─── Progress ring (donut arc) ─────────────────────────────────────────────────
function ProgressRing({
  pct,
  color,
  size = 72,
  stroke = 6,
}: {
  pct: number;
  color: string;
  size?: number;
  stroke?: number;
}) {
  const r   = (size - stroke) / 2;
  const c   = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(1, pct / 100)));
  const cx  = size / 2;
  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="currentColor" strokeWidth={stroke}
        className="text-border/20" />
      <circle cx={cx} cy={cx} r={r} fill="none"
        stroke={color} strokeWidth={stroke}
        strokeDasharray={c} strokeDashoffset={off}
        strokeLinecap="round"
        style={{ transition: "stroke-dashoffset 0.6s ease" }}
      />
    </svg>
  );
}

// ─── Sparkline chart for individual loan ──────────────────────────────────────
function SparkLine({ rows, extraRows }: { rows: AmortRow[]; extraRows: AmortRow[] }) {
  const total = rows.length;
  if (total === 0) return <div className="h-20 flex items-center justify-center text-foreground/20 text-xs">No data</div>;

  const step   = Math.max(1, Math.floor(total / 30));
  const pts    = rows.filter((_, i) => i % step === 0 || i === total - 1);
  const xPts   = extraRows.filter((_, i) => i % step === 0 || i === extraRows.length - 1);
  const maxBal = rows[0].balance + rows[0].principal + rows[0].interest;
  const W = 100; const H = 60;
  const maxLen = Math.max(rows.length, extraRows.length) || 1;

  const toX = (m: number) => (m / maxLen) * W;
  const toY = (b: number) => H - (b / maxBal) * H;

  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${toX(p.month).toFixed(1)},${toY(p.balance).toFixed(1)}`).join(" ");
  const extraPath = xPts.length > 0
    ? xPts.map((p, i) => `${i === 0 ? "M" : "L"}${toX(p.month).toFixed(1)},${toY(p.balance).toFixed(1)}`).join(" ")
    : null;
  const areaPath = `${path} L${toX(pts[pts.length - 1].month).toFixed(1)},${H} L0,${H} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-20" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`lg-${rows[0]?.month}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#7c3aed" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#7c3aed" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#lg-${rows[0]?.month})`} />
      <path d={path} fill="none" stroke="#7c3aed" strokeWidth="0.9" />
      {extraPath && (
        <path d={extraPath} fill="none" stroke="#10b981" strokeWidth="0.9" strokeDasharray="2,1" />
      )}
      {extraPath && (
        <circle cx={toX(xPts[xPts.length - 1].month)} cy={toY(xPts[xPts.length - 1].balance)} r="1.5" fill="#10b981" />
      )}
    </svg>
  );
}

// ─── Inline field helper ──────────────────────────────────────────────────────
function Field({ label, helper, children }: { label: string; helper?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium text-foreground/50 block mb-1">{label}</label>
      {children}
      {helper && <p className="text-[10px] text-foreground/30 mt-0.5">{helper}</p>}
    </div>
  );
}

const INPUT_CLS = "w-full bg-background border border-border/60 rounded-xl px-3 py-2 text-sm text-foreground placeholder-foreground/25 focus:outline-none focus:border-accent/60 transition-colors";
const SELECT_CLS = INPUT_CLS;

// ─── Loan form (shared between add + edit) ────────────────────────────────────
type LoanFormValues = {
  name: string; type: string; balance: string; original_amount: string;
  interest_rate: string; monthly_payment: string; notes: string;
  deferral_months: string; deferral_type: "subsidized" | "unsubsidized";
};

const EMPTY_FORM: LoanFormValues = {
  name: "", type: "personal", balance: "", original_amount: "",
  interest_rate: "", monthly_payment: "", notes: "",
  deferral_months: "0", deferral_type: "unsubsidized",
};

function LoanForm({
  value,
  onChange,
  onSubmit,
  onCancel,
  submitLabel = "Save",
}: {
  value: LoanFormValues;
  onChange: (v: LoanFormValues) => void;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  submitLabel?: string;
}) {
  const set = (k: keyof LoanFormValues, v: string) => onChange({ ...value, [k]: v });

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {/* Row 1: Name + Type */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <Field label="Loan Name">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-base pointer-events-none">
                {getLoanMeta(value.type).emoji}
              </span>
              <input
                type="text"
                value={value.name}
                onChange={e => set("name", e.target.value)}
                placeholder="e.g. Chase Auto Loan"
                className={`${INPUT_CLS} pl-9`}
                required
              />
            </div>
          </Field>
        </div>
        <Field label="Loan Type">
          <select value={value.type} onChange={e => set("type", e.target.value)} className={SELECT_CLS}>
            {LOAN_TYPES.map(t => <option key={t.value} value={t.value}>{t.emoji} {t.label}</option>)}
          </select>
        </Field>
        <Field label="Notes" helper="Optional">
          <input
            type="text"
            value={value.notes}
            onChange={e => set("notes", e.target.value)}
            placeholder="Servicer, account #, etc."
            className={INPUT_CLS}
          />
        </Field>
      </div>

      {/* Row 2: Balances */}
      <div className="p-3 rounded-xl bg-background/50 border border-border/30 space-y-3">
        <p className="text-[11px] font-semibold text-foreground/40 uppercase tracking-wider">Balances</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Current Balance ($)">
            <input type="number" step="0.01" min="0" value={value.balance}
              onChange={e => set("balance", e.target.value)}
              placeholder="12,500.00"
              className={INPUT_CLS} required />
          </Field>
          <Field label="Original Amount ($)" helper="For progress tracking">
            <input type="number" step="0.01" min="0" value={value.original_amount}
              onChange={e => set("original_amount", e.target.value)}
              placeholder="Optional"
              className={INPUT_CLS} />
          </Field>
        </div>
      </div>

      {/* Row 3: Rates */}
      <div className="p-3 rounded-xl bg-background/50 border border-border/30 space-y-3">
        <p className="text-[11px] font-semibold text-foreground/40 uppercase tracking-wider">Rates &amp; Payments</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Annual Interest Rate (%)" helper="Enter 0 for interest-free">
            <input type="number" step="0.01" min="0" max="100" value={value.interest_rate}
              onChange={e => set("interest_rate", e.target.value)}
              placeholder="6.50"
              className={INPUT_CLS} required />
          </Field>
          <Field label="Monthly Payment ($)">
            <input type="number" step="0.01" min="0.01" value={value.monthly_payment}
              onChange={e => set("monthly_payment", e.target.value)}
              placeholder="350.00"
              className={INPUT_CLS} required />
          </Field>
        </div>
      </div>

      {/* Deferral */}
      <div className="p-3 rounded-xl bg-yellow-500/5 border border-yellow-500/20 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold text-yellow-400/70 uppercase tracking-wider">Deferment</p>
          <span className="text-[10px] text-foreground/30">for student loans, forbearance, etc.</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Deferred Months Remaining" helper="Enter 0 to disable">
            <input type="number" min={0} max={60} value={value.deferral_months}
              onChange={e => set("deferral_months", e.target.value)}
              placeholder="0"
              className={INPUT_CLS} />
          </Field>
          <Field label="Interest During Deferment">
            <div className="flex gap-2">
              {(["subsidized", "unsubsidized"] as const).map(t => (
                <button
                  key={t} type="button"
                  onClick={() => onChange({ ...value, deferral_type: t })}
                  className={"flex-1 py-2 rounded-xl text-xs font-semibold border transition-all " + (value.deferral_type === t ? "bg-yellow-500/15 border-yellow-500/40 text-yellow-400" : "bg-background border-border/40 text-foreground/40 hover:border-border/70")}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-foreground/30 mt-1">
              {value.deferral_type === "subsidized"
                ? "Govt pays interest — balance stays flat"
                : "Interest accrues — balance grows"}
            </p>
          </Field>
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <button type="submit"
          className="px-5 py-2 bg-accent hover:bg-accent/90 text-white rounded-xl text-sm font-semibold transition-colors">
          {submitLabel}
        </button>
        <button type="button" onClick={onCancel}
          className="px-4 py-2 text-foreground/50 hover:text-foreground text-sm rounded-xl transition-colors">
          Cancel
        </button>
      </div>
    </form>
  );
}

// ─── Extra Payment Simulator ──────────────────────────────────────────────────
function ExtraPaymentSim({
  loan,
  baseRows,
}: {
  loan: Loan;
  baseRows: AmortRow[];
}) {
  const [extra, setExtra] = useState(0);
  const deferralMonths = loan.deferral_months ?? 0;
  const subsidized     = (loan.deferral_type ?? "unsubsidized") === "subsidized";

  const extraRows = useMemo(() => extra > 0
    ? buildAmortSchedule(loan.balance, loan.interest_rate, loan.monthly_payment + extra, 600, deferralMonths, subsidized)
    : [], [loan, extra, deferralMonths, subsidized]);

  const baseInterest  = totalInterest(baseRows);
  const extraInterest = totalInterest(extraRows);
  const saved         = extra > 0 ? baseInterest - extraInterest : 0;
  const moSaved       = extra > 0 ? baseRows.length - extraRows.length : 0;
  const maxExtra      = Math.max(loan.monthly_payment * 4, 2000);

  return (
    <div className="rounded-xl bg-background/60 border border-border/30 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Zap className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
        <span className="text-xs font-semibold text-foreground/70">Extra payment simulator</span>
        {extra > 0 && (
          <span className="ml-auto text-xs font-bold text-yellow-400">+{formatCurrency(extra)}/mo</span>
        )}
      </div>

      <input
        type="range" min={0} max={maxExtra} step={25}
        value={extra}
        onChange={e => setExtra(Number(e.target.value))}
        className="w-full accent-yellow-400"
      />
      <div className="flex justify-between text-[10px] text-foreground/30">
        <span>$0</span>
        <span>{formatCurrency(maxExtra)}</span>
      </div>

      {extra > 0 && (
        <div className="grid grid-cols-2 gap-2 pt-1">
          <div className="rounded-lg bg-background p-2.5 space-y-1">
            <p className="text-[10px] text-foreground/40 uppercase tracking-wider">Without extra</p>
            <p className="text-sm font-bold text-foreground">{payoffDate(baseRows.length)}</p>
            <p className="text-[11px] text-red-400/80">Interest: {formatCurrency(baseInterest)}</p>
          </div>
          <div className="rounded-lg bg-green-500/8 border border-green-500/20 p-2.5 space-y-1">
            <p className="text-[10px] text-green-400/60 uppercase tracking-wider">With extra</p>
            <p className="text-sm font-bold text-green-400">{payoffDate(extraRows.length)}</p>
            <p className="text-[11px] text-green-400/70">Save {formatCurrency(saved)} · {moSaved}mo sooner</p>
          </div>
        </div>
      )}

      {extra > 0 && <SparkLine rows={baseRows} extraRows={extraRows} />}
    </div>
  );
}

// ─── Single Loan Card ─────────────────────────────────────────────────────────
function LoanCard({ loan, onRefresh }: { loan: Loan; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing]   = useState(false);
  const [editForm, setEditForm] = useState<LoanFormValues>(EMPTY_FORM);
  const [simOpen, setSimOpen]   = useState(false);

  const meta           = getLoanMeta(loan.type);
  const colors         = getTypeColors(loan.type);
  const deferralMonths = loan.deferral_months ?? 0;
  const subsidized     = (loan.deferral_type ?? "unsubsidized") === "subsidized";

  const baseRows = useMemo(
    () => buildAmortSchedule(loan.balance, loan.interest_rate, loan.monthly_payment, 600, deferralMonths, subsidized),
    [loan, deferralMonths, subsidized],
  );

  const lifetimeInterest = useMemo(() => totalInterest(baseRows), [baseRows]);

  const progress = loan.original_amount && loan.original_amount > 0
    ? Math.min(100, ((loan.original_amount - loan.balance) / loan.original_amount) * 100)
    : null;

  const repaymentRows     = baseRows.filter(r => !r.deferred);
  const totalInstallments = loan.type === "short_term" && loan.original_amount && loan.monthly_payment > 0
    ? Math.round(loan.original_amount / loan.monthly_payment)
    : repaymentRows.length;
  const paidInstallments  = loan.type === "short_term"
    ? Math.max(0, totalInstallments - repaymentRows.length)
    : 0;

  function startEdit() {
    setEditForm({
      name: loan.name, type: loan.type,
      balance: loan.balance.toString(),
      original_amount: loan.original_amount?.toString() ?? "",
      interest_rate: loan.interest_rate.toString(),
      monthly_payment: loan.monthly_payment.toString(),
      notes: loan.notes ?? "",
      deferral_months: (loan.deferral_months ?? 0).toString(),
      deferral_type: (loan.deferral_type ?? "unsubsidized") as "subsidized" | "unsubsidized",
    });
    setEditing(true);
  }

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    const supabase = createClient();
    await updateLoan(supabase, loan.id, {
      name: editForm.name, type: editForm.type,
      balance: parseFloat(editForm.balance) || 0,
      original_amount: editForm.original_amount ? parseFloat(editForm.original_amount) : null,
      interest_rate: parseFloat(editForm.interest_rate) || 0,
      monthly_payment: parseFloat(editForm.monthly_payment) || 0,
      notes: editForm.notes || null,
      deferral_months: parseInt(editForm.deferral_months) || 0,
      deferral_type: editForm.deferral_type as "subsidized" | "unsubsidized",
    } as any);
    setEditing(false);
    onRefresh();
  }

  async function handleDelete() {
    if (!confirm(`Delete "${loan.name}"? This cannot be undone.`)) return;
    const supabase = createClient();
    await deleteLoan(supabase, loan.id);
    onRefresh();
  }

  const tableRows = expanded
    ? [...baseRows.slice(0, 24), ...(baseRows.length > 24 ? [baseRows[baseRows.length - 1]] : [])]
    : baseRows.slice(0, 6);

  return (
    <div className="rounded-2xl bg-card border border-border/30 overflow-hidden transition-all shadow-md">
      <div className="h-1 w-full" style={{ background: colors.ring, opacity: 0.6 }} />

      <div className="p-5">
        {editing ? (
          <>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-lg">{meta.emoji}</span>
              <h3 className="font-bold text-foreground">Edit Loan</h3>
            </div>
            <LoanForm
              value={editForm}
              onChange={setEditForm}
              onSubmit={handleUpdate}
              onCancel={() => setEditing(false)}
              submitLabel="Save Changes"
            />
          </>
        ) : (
          <div className="space-y-4">
            {/* Header row */}
            <div className="flex items-start gap-3">
              <div className={`w-11 h-11 rounded-2xl ${colors.bg} ${colors.border} border flex items-center justify-center text-xl shrink-0`}>
                {meta.emoji}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-foreground leading-tight truncate">{loan.name}</h3>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${colors.bg} ${colors.text}`}>
                    {meta.label}
                  </span>
                  <span className="text-[11px] text-foreground/40 font-medium">
                    {loan.interest_rate}% APR
                  </span>
                  {deferralMonths > 0 && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-yellow-500/15 text-yellow-400 text-[10px] font-bold border border-yellow-500/20">
                      ⏸ {deferralMonths}mo deferred
                    </span>
                  )}
                </div>
              </div>
              {progress !== null && (
                <div className="relative shrink-0 flex items-center justify-center" style={{ width: 52, height: 52 }}>
                  <ProgressRing pct={progress} color={colors.ring} size={52} stroke={5} />
                  <span className="absolute text-[10px] font-bold text-foreground/70">
                    {Math.round(progress)}%
                  </span>
                </div>
              )}
              <div className="flex items-center gap-0.5 shrink-0 ml-1">
                <button onClick={startEdit}
                  className="p-1.5 rounded-lg text-foreground/30 hover:text-accent hover:bg-accent/10 transition-all">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button onClick={handleDelete}
                  className="p-1.5 rounded-lg text-foreground/30 hover:text-red-400 hover:bg-red-400/10 transition-all">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Key stats */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-background/70 p-3 space-y-0.5">
                <p className="text-[10px] text-foreground/40 uppercase tracking-wider">Balance</p>
                <p className="text-lg font-bold text-red-400 tabular-nums">{formatCurrency(loan.balance)}</p>
                {loan.original_amount && (
                  <p className="text-[10px] text-foreground/30">of {formatCurrency(loan.original_amount)}</p>
                )}
              </div>
              <div className="rounded-xl bg-background/70 p-3 space-y-0.5">
                <p className="text-[10px] text-foreground/40 uppercase tracking-wider">Monthly</p>
                <p className="text-lg font-bold text-foreground tabular-nums">{formatCurrency(loan.monthly_payment)}</p>
                <p className="text-[10px] text-foreground/30">per month</p>
              </div>
              <div className="rounded-xl bg-background/70 p-3 space-y-0.5">
                <p className="text-[10px] text-foreground/40 uppercase tracking-wider">Payoff Date</p>
                <p className="text-sm font-bold text-accent-light">{payoffDate(repaymentRows.length)}</p>
                <p className="text-[10px] text-foreground/30">{payoffLabel(repaymentRows.length)}</p>
              </div>
              <div className="rounded-xl bg-background/70 p-3 space-y-0.5">
                <p className="text-[10px] text-foreground/40 uppercase tracking-wider">Total Interest</p>
                <p className="text-sm font-bold text-orange-400 tabular-nums">{formatCurrency(lifetimeInterest)}</p>
                <p className="text-[10px] text-foreground/30">over loan life</p>
              </div>
            </div>

            {/* Planner badge */}
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-violet-500/8 border border-violet-500/15">
              <CheckCircle2 className="w-3.5 h-3.5 text-violet-400 shrink-0" />
              <p className="text-[11px] text-violet-300/70">
                <span className="font-semibold text-violet-300">{formatCurrency(loan.monthly_payment)}/mo</span> counted in your Planner cash flow
              </p>
            </div>

            {/* Progress bar */}
            {progress !== null && (
              <div>
                <div className="flex items-center justify-between text-[10px] text-foreground/40 mb-1.5">
                  <span>Payoff Progress</span>
                  <span className="font-semibold">{progress.toFixed(1)}% paid</span>
                </div>
                <div className="h-1.5 bg-background rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${progress}%`, background: colors.ring }}
                  />
                </div>
              </div>
            )}

            {/* BNPL Progress */}
            {loan.type === "short_term" && (() => {
              const dots = Array.from({ length: Math.min(totalInstallments, 14) });
              return (
                <div className="p-3 rounded-xl bg-cyan-500/8 border border-cyan-500/20 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-cyan-400">Buy Now Pay Later</span>
                    {loan.interest_rate === 0 && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 border border-green-500/30">
                        0% interest
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-wrap">
                    {dots.map((_, i) => (
                      <div key={i} className={"h-2 flex-1 min-w-4 rounded-full " + (i < paidInstallments ? "bg-cyan-400/80" : "bg-cyan-500/20 border border-cyan-500/30")} />
                    ))}
                    {totalInstallments > 14 && (
                      <span className="text-[10px] text-foreground/30">+{totalInstallments - 14}</span>
                    )}
                  </div>
                  <p className="text-[11px] text-foreground/50">
                    {paidInstallments} of {totalInstallments} payments made · {repaymentRows.length} remaining · {formatCurrency(loan.monthly_payment)}/ea
                  </p>
                </div>
              );
            })()}

            {/* Deferral info */}
            {deferralMonths > 0 && (
              <div className="p-3 rounded-xl bg-yellow-500/8 border border-yellow-500/20 flex items-start gap-3">
                <span className="text-lg shrink-0">⏸</span>
                <div className="text-xs space-y-1">
                  <p className="font-semibold text-yellow-400">
                    {subsidized ? "Subsidized" : "Unsubsidized"} deferment — {deferralMonths} month{deferralMonths !== 1 ? "s" : ""} remaining
                  </p>
                  <p className="text-foreground/50">
                    {subsidized
                      ? ("No payments or interest for " + deferralMonths + " months. Balance stays at " + formatCurrency(loan.balance) + ".")
                      : ("No payments for " + deferralMonths + " months, but interest accrues. Balance will grow to " + formatCurrency(baseRows[deferralMonths - 1]?.balance ?? loan.balance) + ".")}
                  </p>
                </div>
              </div>
            )}

            {/* Notes */}
            {loan.notes && (
              <p className="text-xs text-foreground/40 px-1 italic">"{loan.notes}"</p>
            )}

            {/* Extra payment simulator toggle */}
            <div>
              <button
                onClick={() => setSimOpen(v => !v)}
                className={"w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium border transition-all " + (simOpen ? "bg-yellow-500/10 border-yellow-500/25 text-yellow-400" : "bg-background/60 border-border/30 text-foreground/40 hover:text-foreground/70 hover:border-border/60")}
              >
                <span className="flex items-center gap-2">
                  <Zap className="w-3.5 h-3.5" />
                  Extra payment simulator
                </span>
                {simOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
              {simOpen && (
                <div className="mt-2">
                  <ExtraPaymentSim loan={loan} baseRows={baseRows} />
                </div>
              )}
            </div>

            {/* Amortization table toggle */}
            <button
              onClick={() => setExpanded(v => !v)}
              className="w-full flex items-center justify-center gap-1.5 text-xs text-foreground/35 hover:text-foreground/70 transition-colors py-1"
            >
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              {expanded ? "Hide" : "Show"} amortization schedule
            </button>

            {expanded && (
              <div className="rounded-xl overflow-hidden border border-border/20">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-background/80 text-foreground/40">
                        <th className="text-left px-3 py-2.5 font-medium">Month</th>
                        <th className="text-right px-3 py-2.5 font-medium">Payment</th>
                        <th className="text-right px-3 py-2.5 font-medium">Principal</th>
                        <th className="text-right px-3 py-2.5 font-medium">Interest</th>
                        <th className="text-right px-3 py-2.5 font-medium">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tableRows.map((row, i) => {
                        const isLast = i === tableRows.length - 1 && baseRows.length > tableRows.length;
                        const now = new Date();
                        const d = new Date(now.getFullYear(), now.getMonth() + row.month - 1);
                        const label = `${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
                        return (
                          <>
                            {isLast && (
                              <tr key="ellipsis">
                                <td colSpan={5} className="text-center text-foreground/20 py-2 text-[10px]">· · · {baseRows.length - 24} more months · · ·</td>
                              </tr>
                            )}
                            <tr
                              key={row.month}
                              className={`border-t border-border/10 ${row.deferred ? "bg-yellow-500/5" : "hover:bg-background/60"}`}
                            >
                              <td className={`px-3 py-2 ${row.deferred ? "text-yellow-400/60" : "text-foreground/50"}`}>
                                {label}
                                {row.deferred && <span className="ml-1.5 text-[9px] bg-yellow-500/15 text-yellow-400 px-1 py-0.5 rounded font-bold">DEFERRED</span>}
                              </td>
                              <td className="px-3 py-2 text-right text-foreground">
                                {row.deferred ? "—" : formatCurrency(row.payment)}
                              </td>
                              <td className="px-3 py-2 text-right text-accent-light">
                                {row.deferred ? "—" : formatCurrency(row.principal)}
                              </td>
                              <td className={`px-3 py-2 text-right ${row.deferred ? "text-yellow-400/60" : "text-red-400/80"}`}>
                                {row.interest > 0 ? formatCurrency(row.interest) : "—"}
                              </td>
                              <td className="px-3 py-2 text-right text-foreground/60 tabular-nums">
                                {formatCurrency(row.balance)}
                              </td>
                            </tr>
                          </>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── All-loans summary chart ──────────────────────────────────────────────────
function LoansSummaryChart({ loans }: { loans: Loan[] }) {
  if (loans.length === 0) return null;

  const maxMonths = Math.max(...loans.map(l => {
    const rows = buildAmortSchedule(l.balance, l.interest_rate, l.monthly_payment, 600, l.deferral_months ?? 0, (l.deferral_type ?? "unsubsidized") === "subsidized");
    return rows.length;
  }), 1);

  const totalByMonth: number[] = Array.from({ length: maxMonths }, (_, i) => {
    return loans.reduce((sum, l) => {
      const rows = buildAmortSchedule(l.balance, l.interest_rate, l.monthly_payment, 600, l.deferral_months ?? 0, (l.deferral_type ?? "unsubsidized") === "subsidized");
      if (i < rows.length) return sum + rows[i].balance;
      return sum;
    }, 0);
  });

  const W = 100; const H = 48;
  const maxVal = totalByMonth[0] || 1;
  const step   = Math.max(1, Math.floor(maxMonths / 40));
  const pts    = totalByMonth.filter((_, i) => i % step === 0 || i === maxMonths - 1);
  const toX    = (_: number, i: number) => (i / (pts.length - 1)) * W;
  const toY    = (v: number) => H - (v / maxVal) * H;

  const path = pts.map((v, i) => `${i === 0 ? "M" : "L"}${toX(0, i).toFixed(1)},${toY(v).toFixed(1)}`).join(" ");
  const area = `${path} L${W},${H} L0,${H} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-12" preserveAspectRatio="none">
      <defs>
        <linearGradient id="summGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#a78bfa" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#a78bfa" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#summGrad)" />
      <path d={path} fill="none" stroke="#a78bfa" strokeWidth="0.8" />
    </svg>
  );
}

// ─── Sort options ──────────────────────────────────────────────────────────────
type SortKey = "balance" | "rate" | "payoff" | "name";

function sortLoans(loans: Loan[], key: SortKey): Loan[] {
  return [...loans].sort((a, b) => {
    if (key === "balance") return b.balance - a.balance;
    if (key === "rate")    return b.interest_rate - a.interest_rate;
    if (key === "name")    return a.name.localeCompare(b.name);
    if (key === "payoff") {
      const pa = buildAmortSchedule(a.balance, a.interest_rate, a.monthly_payment, 600).length;
      const pb = buildAmortSchedule(b.balance, b.interest_rate, b.monthly_payment, 600).length;
      return pa - pb;
    }
    return 0;
  });
}

// ─── Main section ──────────────────────────────────────────────────────────────
export default function LoansSection() {
  const [loans,   setLoans]   = useState<Loan[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding,  setAdding]  = useState(false);
  const [addForm, setAddForm] = useState<LoanFormValues>(EMPTY_FORM);
  const [sortKey, setSortKey] = useState<SortKey>("balance");

  const fetchLoans = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const data = await getLoans(supabase);
    setLoans(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchLoans().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const supabase = createClient();
    await createLoan(supabase, {
      name: addForm.name, type: addForm.type,
      balance: parseFloat(addForm.balance) || 0,
      original_amount: addForm.original_amount ? parseFloat(addForm.original_amount) : undefined,
      interest_rate: parseFloat(addForm.interest_rate) || 0,
      monthly_payment: parseFloat(addForm.monthly_payment) || 0,
      notes: addForm.notes || undefined,
      deferral_months: parseInt(addForm.deferral_months) || 0,
      deferral_type: addForm.deferral_type,
    });
    setAddForm(EMPTY_FORM);
    setAdding(false);
    fetchLoans();
  }

  const totalBalance  = loans.reduce((s, l) => s + l.balance, 0);
  const totalMonthly  = loans.reduce((s, l) => s + l.monthly_payment, 0);

  const totalInterestAll = useMemo(() => loans.reduce((s, l) => {
    const rows = buildAmortSchedule(l.balance, l.interest_rate, l.monthly_payment, 600, l.deferral_months ?? 0, (l.deferral_type ?? "unsubsidized") === "subsidized");
    return s + totalInterest(rows);
  }, 0), [loans]);

  const longestPayoff = useMemo(() => {
    if (loans.length === 0) return 0;
    return Math.max(...loans.map(l =>
      buildAmortSchedule(l.balance, l.interest_rate, l.monthly_payment, 600, l.deferral_months ?? 0, (l.deferral_type ?? "unsubsidized") === "subsidized").length
    ));
  }, [loans]);

  const debtFreeYear = useMemo(() => {
    if (longestPayoff === 0) return null;
    const now = new Date();
    const d   = new Date(now.getFullYear(), now.getMonth() + longestPayoff);
    return `${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
  }, [longestPayoff]);

  const sorted = useMemo(() => sortLoans(loans, sortKey), [loans, sortKey]);

  const SORT_OPTS: { key: SortKey; label: string }[] = [
    { key: "balance", label: "Balance" },
    { key: "rate",    label: "Rate" },
    { key: "payoff",  label: "Payoff" },
    { key: "name",    label: "Name" },
  ];

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="rounded-2xl bg-linear-to-br from-violet-600/15 via-purple-500/10 to-transparent border border-violet-500/20 p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-violet-500/20 border border-violet-500/20">
            <TrendingDown className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-foreground">Loans</h2>
            <p className="text-sm text-foreground/50">
              {loans.length > 0
                ? `${loans.length} active loan${loans.length !== 1 ? "s" : ""} · debt-free ${debtFreeYear ?? "soon"}`
                : "Track and pay down your loans"}
            </p>
          </div>
          <button
            onClick={() => { setAdding(v => !v); setAddForm(EMPTY_FORM); }}
            className="ml-auto flex items-center gap-1.5 px-4 py-2 bg-accent hover:bg-accent/90 text-white rounded-xl text-sm font-semibold transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Loan
          </button>
        </div>

        {loans.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white/5 rounded-xl p-4 space-y-1">
              <p className="text-white/50 text-[10px] uppercase tracking-wider">Total Owed</p>
              <p className="text-red-300 text-xl font-bold tabular-nums">{formatCurrency(totalBalance)}</p>
            </div>
            <div className="bg-white/5 rounded-xl p-4 space-y-1">
              <p className="text-white/50 text-[10px] uppercase tracking-wider">Monthly</p>
              <p className="text-white text-xl font-bold tabular-nums">{formatCurrency(totalMonthly)}</p>
            </div>
            <div className="bg-white/5 rounded-xl p-4 space-y-1">
              <p className="text-white/50 text-[10px] uppercase tracking-wider">Total Interest</p>
              <p className="text-orange-300 text-xl font-bold tabular-nums">{formatCurrency(totalInterestAll)}</p>
            </div>
            <div className="bg-white/5 rounded-xl p-4 space-y-1">
              <p className="text-white/50 text-[10px] uppercase tracking-wider">Debt Free</p>
              <p className="text-violet-300 text-xl font-bold">{debtFreeYear ?? "—"}</p>
            </div>
          </div>
        )}

        {loans.length > 0 && (
          <div>
            <p className="text-[10px] text-white/30 uppercase tracking-wider mb-2">Combined balance trajectory</p>
            <LoansSummaryChart loans={loans} />
          </div>
        )}
      </div>

      {/* Add form */}
      {adding && (
        <div className="rounded-2xl bg-card border border-border/50 p-6">
          <div className="flex items-center gap-2 mb-5">
            <Target className="w-4 h-4 text-accent" />
            <h3 className="font-bold text-foreground">Add New Loan</h3>
          </div>
          <LoanForm
            value={addForm}
            onChange={setAddForm}
            onSubmit={handleCreate}
            onCancel={() => setAdding(false)}
            submitLabel="Add Loan"
          />
        </div>
      )}

      {/* Sort bar */}
      {!loading && loans.length > 1 && (
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="w-3.5 h-3.5 text-foreground/30 shrink-0" />
          <span className="text-xs text-foreground/30 mr-1">Sort</span>
          <div className="flex gap-1.5 flex-wrap">
            {SORT_OPTS.map(o => (
              <button
                key={o.key}
                onClick={() => setSortKey(o.key)}
                className={"px-3 py-1 rounded-lg text-xs font-medium transition-all " + (sortKey === o.key ? "bg-accent/15 text-accent border border-accent/25" : "bg-card border border-border/30 text-foreground/40 hover:text-foreground/70 hover:border-border/60")}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Loan cards */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-4 border-accent/30 border-t-accent rounded-full animate-spin" />
        </div>
      ) : loans.length === 0 ? (
        <div className="rounded-2xl bg-card border border-border/40 p-14 text-center space-y-3">
          <div className="text-5xl mb-2">💼</div>
          <p className="text-foreground/60 font-medium">No loans tracked yet</p>
          <p className="text-foreground/30 text-sm max-w-xs mx-auto">Add your first loan to track your payoff journey and see it reflected in your Planner.</p>
          <button
            onClick={() => setAdding(true)}
            className="mt-2 inline-flex items-center gap-2 px-5 py-2.5 bg-accent hover:bg-accent/90 text-white rounded-xl text-sm font-semibold transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Your First Loan
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {sorted.map(loan => (
            <LoanCard key={loan.id} loan={loan} onRefresh={fetchLoans} />
          ))}
        </div>
      )}

      {/* Payoff strategy tips */}
      {loans.length > 1 && (() => {
        const highestRate = [...loans].sort((a, b) => b.interest_rate - a.interest_rate)[0];
        const lowestBal   = [...loans].sort((a, b) => a.balance - b.balance)[0];
        return (
          <div className="rounded-2xl bg-card border border-border/40 p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Flame className="w-4 h-4 text-orange-400" />
              <h3 className="font-semibold text-foreground text-sm">Payoff Strategy Tips</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-xl p-4 bg-orange-500/8 border border-orange-500/15 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-orange-400 text-xs font-bold uppercase tracking-wider">Avalanche</span>
                  <span className="ml-auto text-[10px] text-orange-400/60">Saves most interest</span>
                </div>
                <p className="text-sm font-semibold text-foreground">Pay off <span className="text-orange-300">{highestRate.name}</span> first</p>
                <p className="text-xs text-foreground/50">Highest rate at {highestRate.interest_rate}% APR — minimize total interest paid.</p>
              </div>
              <div className="rounded-xl p-4 bg-sky-500/8 border border-sky-500/15 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-sky-400 text-xs font-bold uppercase tracking-wider">Snowball</span>
                  <span className="ml-auto text-[10px] text-sky-400/60">Builds momentum</span>
                </div>
                <p className="text-sm font-semibold text-foreground">Pay off <span className="text-sky-300">{lowestBal.name}</span> first</p>
                <p className="text-xs text-foreground/50">Lowest balance at {formatCurrency(lowestBal.balance)} — get a quick win.</p>
              </div>
            </div>
            <p className="text-[11px] text-foreground/30 text-center pt-1">
              Paying off any loan frees up cash reflected in your <span className="text-violet-400">Planner</span>.
            </p>
          </div>
        );
      })()}
    </div>
  );
}
