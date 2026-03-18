"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Plus, Trash2, ChevronLeft, ChevronRight, ChevronDown,
  TrendingUp, Zap, DollarSign, Edit2, Check, X, Calendar, ScanSearch, BarChart2, Sparkles,
  Building, CheckCircle2, Circle, MapPin, Calculator,
} from "lucide-react";
import { formatCurrency } from "@/lib/format";

// ─── Types ────────────────────────────────────────────────────────────────────
type EventType = "bonus" | "tax" | "expense" | "income" | "investment" | "other";

interface PlannerEvent {
  id: string;
  year: number;
  month: number; // 1-12
  label: string;
  amount: number; // positive = income, negative = expense
  type: EventType;
}

interface SalaryPeriod {
  id: string;
  startYear: number;
  startMonth: number; // 1-12
  monthlySalary: number;
  label: string;
}

interface VestingGrant {
  id: string;
  label: string;          // e.g. "Initial RSU Grant"
  totalValue: number;     // total $ value of the full grant
  hireYear: number;
  hireMonth: number;      // 1-12
  vestOffsets: number[];  // months from hire date, e.g. [6, 18, 30]
}

type BonusAmountType = "fixed" | "pct_salary";

interface RecurringBonus {
  id: string;
  label: string;
  month: number;          // 1-12, which month each year
  startYear: number;
  endYear: number | null; // null = ongoing
  amountType: BonusAmountType;
  amountMin: number;      // $ or % depending on amountType
  amountMax: number;
}

interface RecurringCharge {
  id: string;
  label: string;
  amount: number;   // monthly $, always positive
  category: "housing" | "food" | "transport" | "subscriptions" | "utilities" | "debt" | "other";
}

interface ScenarioLineItem {
  id: string;
  label: string;
  amount: number; // positive = cost
}

interface ScenarioEvent {
  id: string;
  label: string;
  emoji: string;
  year: number;
  month: number; // 1-12
  items: ScenarioLineItem[];
}

interface PlannerConfig {
  startingBalance: number;
  balanceOverride: number | null;
  monthlyExpenses: number;    // fallback when recurringCharges is empty
  salaryPeriods: SalaryPeriod[];
  vestingGrants: VestingGrant[];
  recurringBonuses: RecurringBonus[];
  recurringCharges: RecurringCharge[];
  scenarioEvents: ScenarioEvent[];
  events: PlannerEvent[];
}

// ─── Constants ────────────────────────────────────────────────────────────────
const EVENT_META: Record<EventType, { label: string; emoji: string; color: string; bg: string; sign: 1 | -1 }> = {
  bonus:      { label: "Bonus",        emoji: "🎉", color: "text-emerald-400",  bg: "bg-emerald-500/10",  sign:  1 },
  income:     { label: "Extra Income", emoji: "💰", color: "text-emerald-400",  bg: "bg-emerald-500/10",  sign:  1 },
  investment: { label: "Investment",   emoji: "📈", color: "text-blue-400",     bg: "bg-blue-500/10",     sign: -1 },
  tax:        { label: "Tax Payment",  emoji: "🏛️", color: "text-rose-400",     bg: "bg-rose-500/10",     sign: -1 },
  expense:    { label: "Big Expense",  emoji: "💸", color: "text-orange-400",   bg: "bg-orange-500/10",   sign: -1 },
  other:      { label: "Other",        emoji: "📌", color: "text-purple-400",   bg: "bg-purple-500/10",   sign:  1 },
};

const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTHS_FULL  = ["January","February","March","April","May","June","July","August","September","October","November","December"];

const NOW       = new Date();
const CUR_YEAR       = NOW.getFullYear();
const CUR_MONTH      = NOW.getMonth() + 1;
const THIS_MONTH_KEY = `${CUR_YEAR}-${String(CUR_MONTH).padStart(2, "0")}`;

function uid() { return Math.random().toString(36).slice(2, 10); }

const DEFAULT_CONFIG: PlannerConfig = {
  startingBalance: 0,
  balanceOverride: null,
  monthlyExpenses: 0,
  salaryPeriods: [
    { id: "s0", startYear: CUR_YEAR, startMonth: 1, monthlySalary: 5000, label: "Current Salary" },
  ],
  vestingGrants: [],
  recurringBonuses: [],
  recurringCharges: [],
  scenarioEvents: [],
  events: [],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getSalaryForMonth(periods: SalaryPeriod[], year: number, month: number): number {
  const applicable = periods
    .filter(p => p.startYear < year || (p.startYear === year && p.startMonth <= month))
    .sort((a, b) => (a.startYear * 12 + a.startMonth) - (b.startYear * 12 + b.startMonth));
  return applicable.length > 0 ? applicable[applicable.length - 1].monthlySalary : 0;
}

/** Computes all vest events (month + year + amount) derived from vesting grants. */
function getVestEvents(grants: VestingGrant[]): Array<{ year: number; month: number; label: string; amount: number }> {
  const out: Array<{ year: number; month: number; label: string; amount: number }> = [];
  for (const g of grants) {
    if (!g.vestOffsets.length) continue;
    const perVest = g.totalValue / g.vestOffsets.length;
    for (const off of g.vestOffsets) {
      const tot = (g.hireMonth - 1) + off;
      out.push({ year: g.hireYear + Math.floor(tot / 12), month: (tot % 12) + 1, label: `${g.label}`, amount: perVest });
    }
  }
  return out;
}

/** Returns the $ amount for a recurring bonus under a given scenario. */
function getBonusAmount(b: RecurringBonus, salary: number, scenario: "low" | "mid" | "high"): number {
  const toAmt = (v: number) => b.amountType === "pct_salary" ? salary * v / 100 : v;
  const min = toAmt(b.amountMin), max = toAmt(b.amountMax);
  return scenario === "low" ? min : scenario === "high" ? max : (min + max) / 2;
}

type FilingStatus = "single" | "mfj" | "mfs" | "hoh";

/** Given an annual gross salary and filing status, returns the monthly after-tax take-home. */
function computeMonthlyNet(annualSalary: number, filingStatus: FilingStatus): number {
  if (!annualSalary || annualSalary <= 0) return 0;
  type Bracket = [number, number, number];
  const brackets: Record<string, Bracket[]> = {
    single: [[0,11925,.10],[11925,48475,.12],[48475,103350,.22],[103350,197300,.24],[197300,250525,.32],[250525,626350,.35],[626350,Infinity,.37]],
    mfj:    [[0,23850,.10],[23850,96950,.12],[96950,206700,.22],[206700,394600,.24],[394600,501050,.32],[501050,751600,.35],[751600,Infinity,.37]],
    mfs:    [[0,11925,.10],[11925,48475,.12],[48475,103350,.22],[103350,197300,.24],[197300,250525,.32],[250525,375800,.35],[375800,Infinity,.37]],
    hoh:    [[0,17000,.10],[17000,64850,.12],[64850,103350,.22],[103350,197300,.24],[197300,250500,.32],[250500,626350,.35],[626350,Infinity,.37]],
  };
  const stdDed: Record<string, number> = { single: 15000, mfj: 30000, mfs: 15000, hoh: 22500 };
  const taxable = Math.max(0, annualSalary - stdDed[filingStatus]);
  let federal = 0;
  for (const [min, max, rate] of brackets[filingStatus]) {
    if (taxable <= min) break;
    federal += (Math.min(taxable, max) - min) * rate;
  }
  const ss       = Math.min(annualSalary, 176100) * 0.062;
  const medicare = annualSalary * 0.0145 + Math.max(0, annualSalary - (filingStatus === "mfj" ? 250000 : 200000)) * 0.009;
  const waCares  = annualSalary * 0.0058;
  return (annualSalary - federal - ss - medicare - waCares) / 12;
}

interface MonthData { year: number; month: number; balance: number; net: number; salary: number; }

// Returns the payment amount for a loan in a given calendar month, respecting deferral.
function loanPaymentForMonth(
  loan: { monthly_payment: number; deferral_months: number | null; created_at: string | null },
  year: number,
  month: number,
): number {
  const defMonths = loan.deferral_months ?? 0;
  if (!defMonths) return loan.monthly_payment;
  const created = loan.created_at ? new Date(loan.created_at) : null;
  if (!created || isNaN(created.getTime())) return loan.monthly_payment;
  // First payment month = created date + deferral_months calendar months
  const firstPayYear  = created.getFullYear() + Math.floor((created.getMonth() + defMonths) / 12);
  const firstPayMonth = ((created.getMonth() + defMonths) % 12) + 1; // 1-indexed
  return (year > firstPayYear || (year === firstPayYear && month >= firstPayMonth))
    ? loan.monthly_payment
    : 0;
}

function projectBalances(
  config: PlannerConfig,
  fromYear: number,
  fromMonth: number,
  numMonths: number,
  scenario: "low" | "mid" | "high" = "mid",
  loanPaymentsTotal: number | ((y: number, m: number) => number) = 0,
): MonthData[] {
  let balance = config.startingBalance;
  const vestEvs = getVestEvents(config.vestingGrants ?? []);
  const result: MonthData[] = [];
  for (let i = 0; i < numMonths; i++) {
    const m = ((fromMonth - 1 + i) % 12) + 1;
    const y = fromYear + Math.floor((fromMonth - 1 + i) / 12);
    const salary    = getSalaryForMonth(config.salaryPeriods, y, m);
    const evtSum    = config.events.filter(e => e.year === y && e.month === m).reduce((s, e) => s + e.amount, 0);
    const vestSum   = vestEvs.filter(e => e.year === y && e.month === m).reduce((s, e) => s + e.amount, 0);
    const bonusSum  = (config.recurringBonuses ?? [])
      .filter(b => b.month === m && b.startYear <= y && (b.endYear === null || b.endYear >= y))
      .reduce((s, b) => s + getBonusAmount(b, salary, scenario), 0);
    const chargesTotal = (config.recurringCharges ?? []).reduce((s, c) => s + c.amount, 0);
    const loanAmt = typeof loanPaymentsTotal === "function" ? loanPaymentsTotal(y, m) : loanPaymentsTotal;
    const expenseTotal = (chargesTotal > 0 ? chargesTotal : config.monthlyExpenses) + loanAmt;
    const scenarioSum  = (config.scenarioEvents ?? []).filter(s => s.year === y && s.month === m)
      .reduce((sum, s) => sum + s.items.reduce((is, it) => is + it.amount, 0), 0);
    const net = salary - expenseTotal - scenarioSum + evtSum + vestSum + bonusSum;
    balance += net;
    result.push({ year: y, month: m, balance, net, salary });
  }
  return result;
}

// ─── Recurring charge detection ──────────────────────────────────────────────
interface RecurringSuggestion {
  key: string;          // normalized merchant key
  label: string;        // display name
  amount: number;       // recurring amount
  monthCount: number;   // how many consecutive months it appeared
}

function detectRecurring(transactions: Array<{ name: string; merchant_name: string | null; amount: number; date: string; transaction_type: string }>): RecurringSuggestion[] {
  // Step 1: group by merchant → per-month total
  const map = new Map<string, { label: string; byMonth: Map<string, number> }>();
  for (const tx of transactions) {
    if (tx.transaction_type !== "expense") continue;
    const raw = (tx.merchant_name || tx.name || "").trim();
    if (!raw) continue;
    const key = raw.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!key) continue;
    const mo = tx.date.slice(0, 7); // YYYY-MM
    if (!map.has(key)) map.set(key, { label: raw, byMonth: new Map() });
    const entry = map.get(key)!;
    entry.byMonth.set(mo, (entry.byMonth.get(mo) ?? 0) + Math.abs(tx.amount));
  }

  // Helper: YYYY-MM → ordinal month index
  const moIdx = (s: string) => { const [y, m] = s.split("-").map(Number); return y * 12 + m - 1; };

  const results: RecurringSuggestion[] = [];

  for (const [key, { label, byMonth }] of map) {
    if (byMonth.size < 2) continue;

    // Round each month's total to cents
    const entries: [string, number][] = [...byMonth.entries()]
      .map(([mo, amt]): [string, number] => [mo, Math.round(amt * 100) / 100])
      .sort((a, b) => moIdx(a[0]) - moIdx(b[0]));

    // Find the longest run of consecutive months that all share the same amount
    let bestRun: Array<[string, number]> = [];
    let run: Array<[string, number]> = [entries[0]];

    for (let i = 1; i < entries.length; i++) {
      const [prevMo, prevAmt] = entries[i - 1];
      const [curMo,  curAmt]  = entries[i];
      const consecutive = moIdx(curMo) - moIdx(prevMo) === 1;
      const sameAmount  = Math.abs(curAmt - prevAmt) <= Math.max(prevAmt * 0.01, 0.50); // ≤1% or 50¢ tolerance
      if (consecutive && sameAmount) {
        run.push(entries[i]);
      } else {
        if (run.length > bestRun.length) bestRun = run;
        run = [entries[i]];
      }
    }
    if (run.length > bestRun.length) bestRun = run;

    if (bestRun.length < 2) continue;

    // Amount = the most frequent value in the best run
    const freq = new Map<number, number>();
    for (const [, a] of bestRun) freq.set(a, (freq.get(a) ?? 0) + 1);
    const amount = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0];
    if (amount < 1) continue;

    results.push({ key, label, amount, monthCount: bestRun.length });
  }

  return results.sort((a, b) => b.amount - a.amount);
}

// ─── Projection Chart (SVG, 3 years) ─────────────────────────────────────────
function ProjectionChart({ config, loanPaymentsTotal = 0 }: { config: PlannerConfig; loanPaymentsTotal?: number | ((y: number, m: number) => number) }) {
  const NUM = 36;
  const W = 900, H = 300;
  const PAD = { t: 24, r: 20, b: 40, l: 72 };
  const cW = W - PAD.l - PAD.r;
  const cH = H - PAD.t - PAD.b;

  const dataMid  = useMemo(() => projectBalances(config, CUR_YEAR, CUR_MONTH, NUM, "mid",  loanPaymentsTotal), [config, loanPaymentsTotal]);
  const dataLow  = useMemo(() => projectBalances(config, CUR_YEAR, CUR_MONTH, NUM, "low",  loanPaymentsTotal), [config, loanPaymentsTotal]);
  const dataHigh = useMemo(() => projectBalances(config, CUR_YEAR, CUR_MONTH, NUM, "high", loanPaymentsTotal), [config, loanPaymentsTotal]);

  const hasRange = (config.recurringBonuses ?? []).some(b => b.amountMin !== b.amountMax);

  const allBals = [
    ...dataMid.map(d => d.balance),
    ...(hasRange ? dataLow.map(d => d.balance)  : []),
    ...(hasRange ? dataHigh.map(d => d.balance) : []),
  ];
  const minB  = Math.min(...allBals, 0);
  const maxB  = Math.max(...allBals, 1);
  const range = maxB - minB || 1;

  const xOf = (i: number) => PAD.l + (i / (NUM - 1)) * cW;
  const yOf = (v: number) => PAD.t + cH - ((v - minB) / range) * cH;

  const midLine  = dataMid.map((d, i)  => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)},${yOf(d.balance).toFixed(1)}`).join(" ");
  const highLine = dataHigh.map((d, i) => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)},${yOf(d.balance).toFixed(1)}`).join(" ");
  const lowLine  = dataLow.map((d, i)  => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)},${yOf(d.balance).toFixed(1)}`).join(" ");
  const fillPath = `${midLine} L${xOf(NUM-1).toFixed(1)},${(PAD.t+cH).toFixed(1)} L${xOf(0).toFixed(1)},${(PAD.t+cH).toFixed(1)} Z`;
  // band: high path forward + low path backward
  const bandPath = hasRange
    ? `${highLine} ${[...Array(NUM)].map((_, ri) => `L${xOf(NUM-1-ri).toFixed(1)},${yOf(dataLow[NUM-1-ri].balance).toFixed(1)}`).join(" ")} Z`
    : "";

  const zeroY = yOf(0);
  const yearBounds = dataMid.reduce<{ i: number; year: number }[]>((acc, d, i) => {
    if (i > 0 && d.month === 1) acc.push({ i, year: d.year });
    return acc;
  }, []);
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(t => minB + t * range);
  const vestEvs = useMemo(() => getVestEvents(config.vestingGrants ?? []), [config.vestingGrants]);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="projGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#6366f1" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#6366f1" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {yTicks.map((v, i) => (
        <line key={i} x1={PAD.l} y1={yOf(v)} x2={W-PAD.r} y2={yOf(v)} stroke="#ffffff08" strokeWidth={1} />
      ))}
      {minB < 0 && <line x1={PAD.l} y1={zeroY} x2={W-PAD.r} y2={zeroY} stroke="#ff444450" strokeWidth={1} strokeDasharray="4 3" />}
      {yearBounds.map(({ i, year }) => (
        <g key={year}>
          <line x1={xOf(i)} y1={PAD.t} x2={xOf(i)} y2={PAD.t+cH} stroke="#ffffff15" strokeWidth={1} strokeDasharray="3 3" />
          <text x={xOf(i)+5} y={PAD.t+13} fill="#ffffff35" fontSize={10} fontWeight="600">{year}</text>
        </g>
      ))}
      {/* Range band (low → high uncertainty) */}
      {hasRange && <path d={bandPath} fill="#6366f118" />}
      {hasRange && <path d={highLine} fill="none" stroke="#6366f148" strokeWidth={1} strokeDasharray="3 2" />}
      {hasRange && <path d={lowLine}  fill="none" stroke="#6366f148" strokeWidth={1} strokeDasharray="3 2" />}
      {/* Main fill + mid line */}
      <path d={fillPath} fill="url(#projGrad)" />
      <path d={midLine}  fill="none" stroke="#6366f1" strokeWidth={2.5} strokeLinejoin="round" />
      {/* One-time event dots – amber */}
      {dataMid.map((d, i) => !config.events.some(e => e.year===d.year && e.month===d.month) ? null : (
        <circle key={`e${i}`} cx={xOf(i)} cy={yOf(d.balance)} r={4} fill="#f59e0b" stroke="#0f0f13" strokeWidth={2} />
      ))}
      {/* Vest dots – indigo */}
      {dataMid.map((d, i) => !vestEvs.some(e => e.year===d.year && e.month===d.month) ? null : (
        <circle key={`v${i}`} cx={xOf(i)} cy={yOf(d.balance)} r={4} fill="#818cf8" stroke="#0f0f13" strokeWidth={2} />
      ))}
      {/* Recurring bonus dots – pink */}
      {dataMid.map((d, i) => !(config.recurringBonuses ?? []).some(b => b.month===d.month && b.startYear<=d.year && (b.endYear===null||b.endYear>=d.year)) ? null : (
        <circle key={`b${i}`} cx={xOf(i)} cy={yOf(d.balance)} r={4} fill="#ec4899" stroke="#0f0f13" strokeWidth={2} />
      ))}
      {/* Salary change dots – green */}
      {config.salaryPeriods.slice(1).map(sp => {
        const idx = dataMid.findIndex(d => d.year===sp.startYear && d.month===sp.startMonth);
        return idx < 0 ? null : <circle key={sp.id} cx={xOf(idx)} cy={yOf(dataMid[idx].balance)} r={5} fill="#22c55e" stroke="#0f0f13" strokeWidth={2} />;
      })}
      {yTicks.map((v, i) => (
        <text key={i} x={PAD.l-8} y={yOf(v)+4} textAnchor="end" fill="#ffffff35" fontSize={9}>
          {Math.abs(v)>=1000 ? `${(v/1000).toFixed(0)}k` : v.toFixed(0)}
        </text>
      ))}
      {dataMid.map((d, i) => i%3!==0 ? null : (
        <text key={i} x={xOf(i)} y={H-8} textAnchor="middle" fill="#ffffff25" fontSize={9}>{MONTHS_SHORT[d.month-1]}</text>
      ))}
    </svg>
  );
}
// ─── Month Card ───────────────────────────────────────────────────────────────
interface AddEventForm { label: string; amount: string; type: EventType; }
const EMPTY_FORM: AddEventForm = { label: "", amount: "", type: "bonus" };

function MonthCard({
  year, month, salary, netSalary, monthlyExpenses, events, vestEvents, recurBonuses, loanPaymentsTotal, scenarioEvents, balance, net, isPast, isToday,
  onAddEvent, onRemoveEvent,
}: {
  year: number; month: number; salary: number; netSalary: number; monthlyExpenses: number;
  events: PlannerEvent[];
  vestEvents: Array<{ label: string; amount: number }>;
  recurBonuses: RecurringBonus[];
  loanPaymentsTotal: number;
  scenarioEvents: ScenarioEvent[];
  balance: number; net: number;
  isPast: boolean; isToday: boolean;
  onAddEvent: (ev: Omit<PlannerEvent, "id">) => void;
  onRemoveEvent: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [form, setForm]     = useState<AddEventForm>(EMPTY_FORM);

  function submit() {
    const amt = parseFloat(form.amount);
    if (!form.label.trim() || isNaN(amt) || amt <= 0) return;
    onAddEvent({
      year, month,
      label:  form.label.trim(),
      amount: EVENT_META[form.type].sign * Math.abs(amt),
      type:   form.type,
    });
    setForm(EMPTY_FORM);
    setAdding(false);
  }

  const positive  = net >= 0;
  const hasExtras = events.length > 0 || vestEvents.length > 0 || recurBonuses.length > 0 || scenarioEvents.length > 0;

  return (
    <div className={`relative rounded-2xl border flex flex-col transition-all overflow-hidden ${
      isToday   ? "border-accent/60 bg-accent/5 shadow-lg shadow-accent/10 ring-1 ring-accent/20"
      : isPast  ? "border-border/15 bg-card/15 opacity-50"
      : "border-border/40 bg-card hover:border-border/70 hover:shadow-md hover:shadow-black/20"
    }`}>
      {/* Top accent stripe */}
      <div className={`h-0.75 w-full rounded-t-2xl ${positive ? "bg-green/50" : "bg-red/50"}`} />

      {/* Header row */}
      <div className="flex items-center justify-between px-2.5 sm:px-4 pt-2.5 sm:pt-4 pb-1.5 sm:pb-2">
        <div className="flex items-center gap-1.5">
          <span className={`font-bold text-xs sm:text-sm tracking-wide ${isToday ? "text-accent" : "text-foreground"}`}>
            {MONTHS_SHORT[month - 1]}
          </span>
          {isToday && (
            <span className="text-[8px] sm:text-[9px] bg-accent/20 text-accent px-1 sm:px-1.5 py-0.5 rounded-full font-bold tracking-widest">
              NOW
            </span>
          )}
        </div>
        <span className={`text-[10px] sm:text-xs font-bold tabular-nums px-1 sm:px-2 py-0.5 rounded-lg ${
          positive ? "bg-green/10 text-green" : "bg-red/10 text-red"
        }`}>
          {positive ? "+" : ""}{formatCurrency(net)}
        </span>
      </div>

      {/* Big balance */}
      <div className="px-2.5 sm:px-4 pb-2 sm:pb-4 pt-0.5 overflow-hidden">
        <div className={`text-base sm:text-[22px] font-bold tabular-nums leading-tight truncate ${balance >= 0 ? "text-foreground" : "text-red"}`}>
          {formatCurrency(balance)}
        </div>
        <div className="text-[9px] sm:text-[10px] text-foreground/25 mt-0.5 sm:mt-1">projected</div>
      </div>

      {/* Income / Spending / Loans mini row */}
      <div className="grid grid-cols-3 border-t border-border/20 divide-x divide-border/20">
        <div className="px-1.5 sm:px-3 py-1.5 sm:py-2">
          <div className="text-[8px] sm:text-[9px] text-foreground/30 uppercase tracking-wider mb-0.5">Income</div>
          <div className="text-[9px] sm:text-xs font-semibold text-green/80 tabular-nums break-all leading-tight">+{formatCurrency(netSalary)}</div>
        </div>
        <div className="px-1.5 sm:px-3 py-1.5 sm:py-2">
          <div className="text-[8px] sm:text-[9px] text-foreground/30 uppercase tracking-wider mb-0.5">Spend</div>
          <div className="text-[9px] sm:text-xs font-semibold text-red/70 tabular-nums break-all leading-tight">−{formatCurrency(monthlyExpenses + scenarioEvents.reduce((s, e) => s + e.items.reduce((si, it) => si + it.amount, 0), 0))}</div>
        </div>
        {loanPaymentsTotal > 0 ? (
          <div className="px-1.5 sm:px-3 py-1.5 sm:py-2">
            <div className="text-[8px] sm:text-[9px] text-foreground/30 uppercase tracking-wider mb-0.5">Loans</div>
            <div className="text-[9px] sm:text-xs font-semibold text-accent/70 tabular-nums break-all leading-tight">−{formatCurrency(loanPaymentsTotal)}</div>
          </div>
        ) : <div />}
      </div>

      {/* Events */}
      {hasExtras && (
        <div className="px-2 sm:px-4 py-3 sm:py-4 space-y-2 border-t border-border/15">
          {events.map(ev => {
            const meta = EVENT_META[ev.type];
            return (
              <div key={ev.id} className={`flex items-center justify-between rounded-xl px-2 sm:px-4 py-2 sm:py-2.5 text-[10px] sm:text-xs gap-1.5 sm:gap-2 ${meta.bg}`}>
                <span className={`flex items-center gap-1.5 sm:gap-2.5 min-w-0 ${meta.color}`}>
                  <span className="shrink-0 text-[11px] sm:text-[13px]">{meta.emoji}</span>
                  <span className="truncate font-medium">{ev.label}</span>
                </span>
                <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                  <span className={`font-semibold tabular-nums ${ev.amount >= 0 ? "text-green" : "text-red"}`}>
                    {ev.amount >= 0 ? "+" : ""}{formatCurrency(ev.amount)}
                  </span>
                  <button onClick={() => onRemoveEvent(ev.id)} className="text-foreground/20 hover:text-red transition-colors p-0.5 rounded">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}
          {vestEvents.map((ev, i) => (
            <div key={i} className="flex items-center justify-between rounded-xl px-2 sm:px-4 py-2 sm:py-2.5 text-[10px] sm:text-xs gap-1.5 sm:gap-2 bg-indigo-500/10">
              <span className="flex items-center gap-1.5 sm:gap-2.5 min-w-0 text-indigo-400">
                <span className="shrink-0 text-[11px] sm:text-[13px]">📊</span>
                <span className="truncate font-medium">{ev.label}</span>
              </span>
              <span className="font-semibold text-green shrink-0 tabular-nums">+{formatCurrency(ev.amount)}</span>
            </div>
          ))}
          {recurBonuses.map(b => {
            const toAmt = (v: number) => b.amountType === "pct_salary" ? salary * v / 100 : v;
            const min = toAmt(b.amountMin), max = toAmt(b.amountMax);
            return (
              <div key={b.id} className="flex items-center justify-between rounded-xl px-2 sm:px-4 py-2 sm:py-2.5 text-[10px] sm:text-xs gap-1.5 sm:gap-2 bg-pink-500/10">
                <span className="flex items-center gap-1.5 sm:gap-2.5 min-w-0 text-pink-400">
                  <span className="shrink-0 text-[11px] sm:text-[13px]">🎯</span>
                  <span className="truncate font-medium">{b.label}</span>
                </span>
                <span className="font-semibold text-green shrink-0 tabular-nums">
                  {min === max ? `+${formatCurrency(min)}` : `+${formatCurrency(min)}–${formatCurrency(max)}`}
                </span>
              </div>
            );
          })}
          {scenarioEvents.map(s => {
            const total = s.items.reduce((sum, it) => sum + it.amount, 0);
            return (
              <div key={s.id} className="flex items-center justify-between rounded-xl px-2 sm:px-4 py-2 sm:py-2.5 text-[10px] sm:text-xs gap-1.5 sm:gap-2 bg-purple-500/10">
                <span className="flex items-center gap-1.5 sm:gap-2.5 min-w-0 text-purple-400">
                  <span className="shrink-0 text-[11px] sm:text-[13px]">{s.emoji}</span>
                  <span className="truncate font-medium">{s.label}</span>
                </span>
                <span className="font-semibold text-orange-400 shrink-0 tabular-nums">−{formatCurrency(total)}</span>
              </div>
            );
          })}

        </div>
      )}

      {/* Add event section */}
      <div className={`mt-auto border-t border-border/15 ${adding ? "px-2 sm:px-4 pt-3 sm:pt-4 pb-4 sm:pb-5" : "px-2 sm:px-4 py-2 sm:py-3"}`}>
        {adding ? (
          <div className="space-y-2">
            <select
              value={form.type}
              onChange={e => setForm(f => ({ ...f, type: e.target.value as EventType }))}
              className="w-full bg-background border border-border/50 rounded-lg px-2 py-1.5 text-xs text-foreground"
            >
              {(Object.keys(EVENT_META) as EventType[]).map(k => (
                <option key={k} value={k}>{EVENT_META[k].emoji} {EVENT_META[k].label}</option>
              ))}
            </select>
            <input
              autoFocus
              placeholder="Label — e.g. Q4 Bonus"
              value={form.label}
              onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
              onKeyDown={e => e.key === "Enter" && submit()}
              className="w-full bg-background border border-border/50 rounded-lg px-2 py-1.5 text-xs text-foreground placeholder-foreground/25"
            />
            <input
              type="number"
              placeholder="Amount ($)"
              value={form.amount}
              onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
              onKeyDown={e => e.key === "Enter" && submit()}
              className="w-full bg-background border border-border/50 rounded-lg px-2 py-1.5 text-xs text-foreground placeholder-foreground/25"
            />
            <div className="flex gap-1.5">
              <button onClick={submit} className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-accent hover:bg-accent/90 text-white text-xs rounded-lg transition-colors font-medium">
                <Check className="w-3 h-3" /> Save
              </button>
              <button onClick={() => { setAdding(false); setForm(EMPTY_FORM); }} className="px-3 py-1.5 text-foreground/40 hover:text-foreground text-xs rounded-lg transition-colors">
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-foreground/40 hover:text-accent hover:bg-accent/5 text-xs transition-all border border-dashed border-border/25 hover:border-accent/30"
          >
            <Plus className="w-3 h-3" /> Add event
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Collapsible section wrapper ──────────────────────────────────────────────
function Accordion({ title, icon, subtitle, defaultOpen = false, gradient = "", children }: {
  title: string; icon: React.ReactNode; subtitle?: string; defaultOpen?: boolean; gradient?: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`bg-linear-to-br border border-border/50 rounded-2xl ${gradient || "from-card to-card bg-card"}`}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-5 py-4 hover:bg-black/5 transition-colors text-left rounded-2xl"
      >
        <div className="shrink-0">{icon}</div>
        <div className="flex-1 min-w-0">
          <span className="font-bold text-sm text-foreground">{title}</span>
          {subtitle && <span className="text-xs text-foreground/40 ml-2 hidden sm:inline">{subtitle}</span>}
        </div>
        <ChevronDown className={`w-4 h-4 text-foreground/40 shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="border-t border-border/20">
          <div className="px-3 pt-4 sm:px-5 sm:pt-5 space-y-4">{children}</div>
          <div className="h-6 sm:h-8" />
        </div>
      )}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function PlannerSection({ netWorth, stockTotal = 0 }: { netWorth: number; stockTotal?: number }) {
  const [config,       setConfig]       = useState<PlannerConfig>(DEFAULT_CONFIG);
  const [dbLoaded,     setDbLoaded]     = useState(false);
  const [viewYear,     setViewYear]     = useState(CUR_YEAR);
  const [editingId,    setEditingId]    = useState<string | null>(null);
  const [salaryDraft,  setSalaryDraft]  = useState<Partial<SalaryPeriod>>({});
  const [addingSalary, setAddingSalary] = useState(false);
  const [newSP,        setNewSP]        = useState<Omit<SalaryPeriod, "id">>({
    startYear: CUR_YEAR, startMonth: CUR_MONTH, monthlySalary: 0, label: "",
  });
  const [addingVest,   setAddingVest]   = useState(false);
  const [newVest,      setNewVest]      = useState<Omit<VestingGrant, "id">>({
    label: "", totalValue: 0, hireYear: CUR_YEAR, hireMonth: CUR_MONTH, vestOffsets: [],
  });
  const [addingBonus,  setAddingBonus]  = useState(false);
  const [vestOffsetInput, setVestOffsetInput] = useState("");
  const [newBonus,     setNewBonus]     = useState<Omit<RecurringBonus, "id">>({
    label: "", month: 9, startYear: CUR_YEAR, endYear: null, amountType: "pct_salary", amountMin: 5, amountMax: 15,
  });
  const [addingCharge,     setAddingCharge]     = useState(false);
  const [newCharge,        setNewCharge]        = useState<Omit<RecurringCharge, "id">>({ label: "", amount: 0, category: "other" });
  const [suggestions,      setSuggestions]      = useState<RecurringSuggestion[]>([]);
  const [dismissedKeys,    setDismissedKeys]    = useState<Set<string>>(new Set());
  const [scanning,         setScanning]         = useState(false);
  const [scanned,          setScanned]          = useState(false);
  const [loans,            setLoans]            = useState<Array<{ id: string; name: string; monthly_payment: number; type: string; deferral_months: number | null; created_at: string | null }>>([]);
  const [paidLoanIds, setPaidLoanIds] = useState<Set<string>>(new Set());
  const [thisMonthTxKeys, setThisMonthTxKeys] = useState<Set<string>>(new Set());

  // Load planner config + loans on mount
  useEffect(() => {
    (async () => {
      const { createClient } = await import("@/lib/supabase/client");
      const sb = createClient();
      const [{ data: loansData }, { data: plannerRow }] = await Promise.all([
        sb.from("loans").select("id, name, monthly_payment, type, deferral_months, created_at"),
        sb.from("planner_configs").select("config, paid_loan_ids, paid_loan_month, dismissed_suggestions, tax_filing_status").maybeSingle(),
      ]);
      setLoans(loansData ?? []);
      if (plannerRow) {
        const saved = plannerRow.config as unknown;
        if (saved && typeof saved === "object") setConfig({ ...DEFAULT_CONFIG, ...(saved as PlannerConfig) });
        if (plannerRow.paid_loan_month === THIS_MONTH_KEY && Array.isArray(plannerRow.paid_loan_ids)) {
          setPaidLoanIds(new Set(plannerRow.paid_loan_ids as string[]));
        }
        if (Array.isArray(plannerRow.dismissed_suggestions)) {
          setDismissedKeys(new Set(plannerRow.dismissed_suggestions as string[]));
        }
        if (plannerRow.tax_filing_status) {
          setTaxFilingStatus(plannerRow.tax_filing_status as FilingStatus);
        }
      } else if (typeof window !== "undefined") {
        // Migrate from localStorage on first load
        const migrate: Record<string, unknown> = {};
        try {
          const lsConfig = localStorage.getItem("wp_planner");
          if (lsConfig) {
            const parsed = JSON.parse(lsConfig) as PlannerConfig;
            setConfig({ ...DEFAULT_CONFIG, ...parsed });
            migrate.config = parsed;
          }
        } catch { /* ignore */ }
        try {
          const lsPaid = localStorage.getItem(`wp_paid_loans_${THIS_MONTH_KEY}`);
          if (lsPaid) {
            const ids = JSON.parse(lsPaid) as string[];
            setPaidLoanIds(new Set(ids));
            migrate.paid_loan_ids = ids;
            migrate.paid_loan_month = THIS_MONTH_KEY;
          }
        } catch { /* ignore */ }
        try {
          const lsDismissed = localStorage.getItem("wp_dismissed_suggestions");
          if (lsDismissed) {
            const keys = JSON.parse(lsDismissed) as string[];
            setDismissedKeys(new Set(keys));
            migrate.dismissed_suggestions = keys;
          }
        } catch { /* ignore */ }
        if (Object.keys(migrate).length > 0) {
          const { upsertPlannerConfig } = await import("@/lib/supabase/queries");
          await upsertPlannerConfig(sb, migrate).catch(() => {});
          // Clean up localStorage after successful migration
          localStorage.removeItem("wp_planner");
          localStorage.removeItem(`wp_paid_loans_${THIS_MONTH_KEY}`);
          localStorage.removeItem("wp_dismissed_suggestions");
        }
      }
      setDbLoaded(true);
    })().catch(() => setDbLoaded(true));
  }, []);

  // Load this month's transactions on mount to auto-detect paid charges
  useEffect(() => {
    const pad = (n: number) => String(n).padStart(2, "0");
    const prefix = `${CUR_YEAR}-${pad(CUR_MONTH)}`;
    (async () => {
      const { createClient } = await import("@/lib/supabase/client");
      const sb = createClient();
      const { data } = await sb
        .from("transactions")
        .select("name, merchant_name, date")
        .eq("transaction_type", "expense")
        .gte("date", `${prefix}-01`)
        .lt("date", `${CUR_YEAR}-${pad(CUR_MONTH + 1 > 12 ? 1 : CUR_MONTH + 1)}-01`);
      const txs = data ?? [];
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const keys = new Set(txs.flatMap(t => [norm(t.name), t.merchant_name ? norm(t.merchant_name) : ""]).filter(Boolean));
      setThisMonthTxKeys(keys);
    })().catch(() => {});
  }, []);

  function toggleLoanPaid(id: string) {
    setPaidLoanIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      savePlanner({ paid_loan_ids: [...next], paid_loan_month: THIS_MONTH_KEY });
      return next;
    });
  }

  // ── Scenario events state ──
  const [addingScenario,     setAddingScenario]     = useState(false);
  const [expandedScenarioId, setExpandedScenarioId] = useState<string | null>(null);
  const [newScenario,        setNewScenario]         = useState({ label: "", emoji: "✈️", year: CUR_YEAR, month: CUR_MONTH });
  const [newItemDrafts,      setNewItemDrafts]       = useState<Record<string, { label: string; amount: string }>>({})

  // ── Tax estimator state ──
  const [taxFilingStatus,   setTaxFilingStatus]   = useState<FilingStatus>("single");
  const [taxIncomeOverride, setTaxIncomeOverride] = useState<string>("");

  const SCENARIO_EMOJIS = ["✈️","💍","🏠","🚗","🎓","🎉","🏖️","🛠️","💻","🌍","🎸","🏋️","🍽️","🎁","⛵"];

  function addScenario() {
    if (!newScenario.label.trim()) return;
    setConfig(c => ({ ...c, scenarioEvents: [...(c.scenarioEvents ?? []), { ...newScenario, id: uid(), items: [] }] }));
    setAddingScenario(false);
    setNewScenario({ label: "", emoji: "✈️", year: CUR_YEAR, month: CUR_MONTH });
  }
  function removeScenario(id: string) {
    setConfig(c => ({ ...c, scenarioEvents: (c.scenarioEvents ?? []).filter(s => s.id !== id) }));
    if (expandedScenarioId === id) setExpandedScenarioId(null);
  }
  function addScenarioItem(scenarioId: string) {
    const draft = newItemDrafts[scenarioId];
    if (!draft?.label.trim() || !draft.amount) return;
    const amt = parseFloat(draft.amount);
    if (isNaN(amt) || amt <= 0) return;
    setConfig(c => ({
      ...c,
      scenarioEvents: (c.scenarioEvents ?? []).map(s =>
        s.id === scenarioId
          ? { ...s, items: [...s.items, { id: uid(), label: draft.label.trim(), amount: amt }] }
          : s,
      ),
    }));
    setNewItemDrafts(prev => ({ ...prev, [scenarioId]: { label: "", amount: "" } }));
  }
  function removeScenarioItem(scenarioId: string, itemId: string) {
    setConfig(c => ({
      ...c,
      scenarioEvents: (c.scenarioEvents ?? []).map(s =>
        s.id === scenarioId ? { ...s, items: s.items.filter(it => it.id !== itemId) } : s,
      ),
    }));
  }

  const scanTransactions = useCallback(async () => {
    setScanning(true);
    try {
      const { createClient } = await import("@/lib/supabase/client");
      const sb = createClient();
      const { data } = await sb
        .from("transactions")
        .select("name, merchant_name, amount, date, transaction_type")
        .eq("transaction_type", "expense")
        .order("date", { ascending: false })
        .limit(500);
      const txs = (data ?? []) as Array<{ name: string; merchant_name: string | null; amount: number; date: string; transaction_type: string }>;
      const found = detectRecurring(txs);
      // filter out ones already added as charges
      const existing = new Set((config.recurringCharges ?? []).map(c => c.label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()));
      setSuggestions(found.filter(s => !existing.has(s.key)));
      setScanned(true);
    } catch { /* ignore */ } finally {
      setScanning(false);
    }
  }, [config.recurringCharges]);

  function dismissSuggestion(key: string) {
    setDismissedKeys(prev => {
      const next = new Set(prev); next.add(key);
      savePlanner({ dismissed_suggestions: [...next] });
      return next;
    });
  }

  function acceptSuggestion(s: RecurringSuggestion) {
    setConfig(c => ({ ...c, recurringCharges: [...(c.recurringCharges ?? []), { id: uid(), label: s.label, amount: s.amount, category: "other" }] }));
    dismissSuggestion(s.key);
  }

  // Use manual override if set, otherwise always use live assets total
  const effectiveConfig = useMemo(
    () => ({ ...config, startingBalance: config.balanceOverride ?? netWorth }),
    [config, netWorth],
  );

  // Persist to Supabase (debounced)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function savePlanner(partial: Record<string, unknown>) {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        const { createClient } = await import("@/lib/supabase/client");
        const sb = createClient();
        const { upsertPlannerConfig } = await import("@/lib/supabase/queries");
        await upsertPlannerConfig(sb, partial);
      } catch { /* ignore */ }
    }, 500);
  }

  useEffect(() => {
    if (!dbLoaded) return;
    savePlanner({ config });
  }, [config, dbLoaded]);

  const totalLoanPayments = useMemo(
    () => loans.reduce((s, l) => s + loanPaymentForMonth(l, CUR_YEAR, CUR_MONTH), 0),
    [loans],
  );

  const getLoanPaymentsForMonth = useCallback(
    (y: number, m: number) => {
      const applicable = (y === CUR_YEAR && m === CUR_MONTH)
        ? loans.filter(l => !paidLoanIds.has(l.id))
        : loans;
      return applicable.reduce((s, l) => s + loanPaymentForMonth(l, y, m), 0);
    },
    [loans, paidLoanIds],
  );

  const totalRecurringCharges = useMemo(
    () => (config.recurringCharges ?? []).reduce((s, c) => s + c.amount, 0),
    [config.recurringCharges],
  );

  const paidChargesTotal = useMemo(() => {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    return (config.recurringCharges ?? []).reduce((s, rc) => {
      const rcKey = norm(rc.label);
      const seen = [...thisMonthTxKeys].some(k => k.includes(rcKey) || rcKey.includes(k));
      return seen ? s + rc.amount : s;
    }, 0);
  }, [config.recurringCharges, thisMonthTxKeys]);

  // Amounts already paid this month — baked into the starting balance so every
  // downstream month's balance cascades correctly (rather than a display-only hack).
  const paidAdjust = useMemo(
    () => paidChargesTotal,
    [paidChargesTotal],
  );

  // Compute projections for the viewed year — always start from the current month so
  // assetsTotal is correctly treated as this month's opening balance, not Jan 1st.
  const yearData = useMemo<MonthData[]>(() => {
    const totalMonths = (viewYear - CUR_YEAR) * 12 + (12 - CUR_MONTH + 1);
    if (totalMonths <= 0) return [];
    // Add paidAdjust to starting balance: charges already paid this month are
    // already reflected in assetsTotal but projectBalances would subtract them
    // again unless we compensate here.
    const adjustedConfig = { ...effectiveConfig, startingBalance: effectiveConfig.startingBalance + paidAdjust };
    const all = projectBalances(adjustedConfig, CUR_YEAR, CUR_MONTH, totalMonths, "mid", getLoanPaymentsForMonth);
    return all.filter(d => d.year === viewYear);
  }, [effectiveConfig, viewYear, getLoanPaymentsForMonth, paidAdjust]);

  // ── summary stats for the viewed year
  const yearStats = useMemo(() => {
    const income   = yearData.reduce((s, d) => s + Math.max(d.salary, 0), 0);
    const chargesTotal = (config.recurringCharges ?? []).reduce((s, c) => s + c.amount, 0);
    const monthlyExp = (chargesTotal > 0 ? chargesTotal : config.monthlyExpenses) + totalLoanPayments;
    const expenses = yearData.length * monthlyExp;
    const events   = config.events.filter(e => e.year === viewYear);
    const eventIncome  = events.filter(e => e.amount > 0).reduce((s, e) => s + e.amount, 0);
    const eventExpense = events.filter(e => e.amount < 0).reduce((s, e) => s + e.amount, 0);
    const endBalance   = yearData[yearData.length - 1]?.balance ?? netWorth;
    return { income, expenses, eventIncome, eventExpense, endBalance };
  }, [yearData, config, viewYear, netWorth, totalLoanPayments]);

  const allVestEvents = useMemo(
    () => getVestEvents(effectiveConfig.vestingGrants ?? []),
    [effectiveConfig.vestingGrants],
  );

  function addEvent(ev: Omit<PlannerEvent, "id">) {
    setConfig(c => ({ ...c, events: [...c.events, { ...ev, id: uid() }] }));
  }
  function removeEvent(id: string) {
    setConfig(c => ({ ...c, events: c.events.filter(e => e.id !== id) }));
  }

  function addVestingGrant() {
    if (!newVest.label.trim() || !newVest.totalValue || !newVest.vestOffsets.length) return;
    setConfig(c => ({ ...c, vestingGrants: [...(c.vestingGrants ?? []), { ...newVest, id: uid() }] }));
    setNewVest({ label: "", totalValue: 0, hireYear: CUR_YEAR, hireMonth: CUR_MONTH, vestOffsets: [] });
    setVestOffsetInput("");
    setAddingVest(false);
  }

  function addRecurringBonus() {
    if (!newBonus.label.trim() || newBonus.amountMax <= 0) return;
    setConfig(c => ({ ...c, recurringBonuses: [...(c.recurringBonuses ?? []), { ...newBonus, id: uid() }] }));
    setNewBonus({ label: "", month: 9, startYear: CUR_YEAR, endYear: null, amountType: "pct_salary", amountMin: 5, amountMax: 15 });
    setAddingBonus(false);
  }

  function addRecurringCharge() {
    if (!newCharge.label.trim() || newCharge.amount <= 0) return;
    setConfig(c => ({ ...c, recurringCharges: [...(c.recurringCharges ?? []), { ...newCharge, id: uid() }] }));
    setNewCharge({ label: "", amount: 0, category: "other" });
    setAddingCharge(false);
  }

  function addSalaryPeriod() {
    if (!newSP.monthlySalary) return;
    setConfig(c => ({
      ...c,
      salaryPeriods: [...c.salaryPeriods, { ...newSP, id: uid() }].sort(
        (a, b) => (a.startYear * 12 + a.startMonth) - (b.startYear * 12 + b.startMonth),
      ),
    }));
    setAddingSalary(false);
    setNewSP({ startYear: CUR_YEAR, startMonth: CUR_MONTH, monthlySalary: 0, label: "" });
  }

  function saveSalaryEdit(id: string) {
    setConfig(c => ({
      ...c,
      salaryPeriods: c.salaryPeriods.map(s => s.id === id ? { ...s, ...salaryDraft } : s),
    }));
    setEditingId(null);
  }

  const yearsWithData = [CUR_YEAR, CUR_YEAR + 1, CUR_YEAR + 2, CUR_YEAR + 3];

  // Net change projected across viewed year
  const yearNetChange = yearStats.endBalance - (yearData[0]?.balance ?? netWorth) + yearData[0]?.net;

  // ── Tax estimate ──
  const taxEstimate = useMemo(() => {
    let annualGross: number;
    let annualSalary = 0;
    let annualBonuses = 0;

    if (taxIncomeOverride) {
      annualGross = parseFloat(taxIncomeOverride);
    } else {
      // Sum salary for every month in viewYear (respects mid-year salary changes)
      for (let m = 1; m <= 12; m++) {
        annualSalary += getSalaryForMonth(config.salaryPeriods, viewYear, m);
      }
      // Add recurring bonuses that fire this year (mid scenario)
      for (const b of (config.recurringBonuses ?? [])) {
        if (b.startYear <= viewYear && (b.endYear === null || b.endYear >= viewYear)) {
          const salary = getSalaryForMonth(config.salaryPeriods, viewYear, b.month);
          annualBonuses += getBonusAmount(b, salary, "mid");
        }
      }
      // Add one-time bonus/income events in viewYear
      // Exclude: tax-type events (tax returns) and any income labelled as loan income
      for (const e of config.events) {
        const lbl = e.label.toLowerCase();
        const isLoanIncome = lbl.includes("loan") || lbl.includes("tax return") || lbl.includes("refund");
        if (e.year === viewYear && e.type === "bonus" && e.amount > 0) {
          annualBonuses += e.amount;
        } else if (e.year === viewYear && e.type === "income" && e.amount > 0 && !isLoanIncome) {
          annualBonuses += e.amount;
        }
      }
      annualGross = annualSalary + annualBonuses;
    }
    if (!annualGross || annualGross <= 0) return null;

    type Bracket = [number, number, number];
    const brackets: Record<string, Bracket[]> = {
      single: [[0,11925,.10],[11925,48475,.12],[48475,103350,.22],[103350,197300,.24],[197300,250525,.32],[250525,626350,.35],[626350,Infinity,.37]],
      mfj:    [[0,23850,.10],[23850,96950,.12],[96950,206700,.22],[206700,394600,.24],[394600,501050,.32],[501050,751600,.35],[751600,Infinity,.37]],
      mfs:    [[0,11925,.10],[11925,48475,.12],[48475,103350,.22],[103350,197300,.24],[197300,250525,.32],[250525,375800,.35],[375800,Infinity,.37]],
      hoh:    [[0,17000,.10],[17000,64850,.12],[64850,103350,.22],[103350,197300,.24],[197300,250500,.32],[250500,626350,.35],[626350,Infinity,.37]],
    };
    const stdDed: Record<string, number> = { single: 15000, mfj: 30000, mfs: 15000, hoh: 22500 };
    const taxable = Math.max(0, annualGross - stdDed[taxFilingStatus]);
    let federal = 0;
    const federalBrackets: { rate: number; from: number; to: number | null; taxed: number; tax: number }[] = [];
    for (const [min, max, rate] of brackets[taxFilingStatus]) {
      if (taxable <= min) break;
      const taxed = Math.min(taxable, max) - min;
      const tax   = taxed * rate;
      federal += tax;
      federalBrackets.push({ rate, from: min, to: max === Infinity ? null : max, taxed, tax });
    }
    const ssWageBase = 176100;
    const ss = Math.min(annualGross, ssWageBase) * 0.062;
    const medicareThreshold = taxFilingStatus === "mfj" ? 250000 : 200000;
    const medicare = annualGross * 0.0145 + Math.max(0, annualGross - medicareThreshold) * 0.009;
    const waCares = annualGross * 0.0058; // WA Cares Fund (LTC)
    const total = federal + ss + medicare + waCares;
    const marginal = [...brackets[taxFilingStatus]].reverse().find(([min]) => taxable > min)?.[2] ?? 0.10;

    // Compute salary-only taxes for the "monthly take-home" hero (excludes lump-sum bonuses)
    const effAnnualSalary = taxIncomeOverride ? annualGross : annualSalary;
    const salTaxable = Math.max(0, effAnnualSalary - stdDed[taxFilingStatus]);
    let salFederal = 0;
    for (const [min, max, rate] of brackets[taxFilingStatus]) {
      if (salTaxable <= min) break;
      salFederal += (Math.min(salTaxable, max) - min) * rate;
    }
    const salSS       = Math.min(effAnnualSalary, ssWageBase) * 0.062;
    const salMedicare = effAnnualSalary * 0.0145 + Math.max(0, effAnnualSalary - medicareThreshold) * 0.009;
    const salWaCares  = effAnnualSalary * 0.0058;
    const salTotal    = salFederal + salSS + salMedicare + salWaCares;
    const monthlySalaryNet = (effAnnualSalary - salTotal) / 12;
    const monthlyGross     = effAnnualSalary / 12;

    return { annualGross, annualSalary, annualBonuses, taxable, federal, federalBrackets, ss, medicare, waCares, total, effectiveRate: total / annualGross, marginal, net: annualGross - total, monthlySalaryNet, monthlyGross };
  }, [taxFilingStatus, taxIncomeOverride, viewYear, config.salaryPeriods, config.recurringBonuses, config.events]);

  return (
    <div className="space-y-6">
      {/* ── Page header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Future Planner</h2>
          <p className="text-foreground/40 text-sm mt-1">Simulate your financial future — salary changes, bonuses, taxes, big expenses.</p>
        </div>
      </div>

      {/* ── 3-Year Projection (Hero) ── */}
      <div className="bg-card border border-border/40 rounded-2xl p-4 sm:p-5 space-y-3 overflow-hidden">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-accent/10 rounded-lg"><Calendar className="w-4 h-4 text-accent" /></div>
            <h3 className="font-semibold text-sm">3-Year Projection</h3>
          </div>
          <div className="flex items-center gap-3 flex-wrap text-xs text-foreground/35">
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> one-time</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-indigo-light inline-block" /> vest</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-pink-light inline-block" /> bonus</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green inline-block" /> salary change</span>
            {(effectiveConfig.recurringBonuses ?? []).some(b => b.amountMin !== b.amountMax) && (
              <span className="flex items-center gap-1.5"><span className="inline-block w-6 h-2 rounded bg-accent/20 border border-accent/30" /> range</span>
            )}
          </div>
        </div>
        <ProjectionChart config={{ ...effectiveConfig, startingBalance: effectiveConfig.startingBalance + paidAdjust }} loanPaymentsTotal={getLoanPaymentsForMonth} />
      </div>

      {/* ── Config + Year Grid (2-col on lg) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4 lg:gap-6">
        {/* Sidebar: config cards (horizontal on mobile, stacked in sidebar on lg) */}
        <div className="order-2 lg:order-1 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 gap-3">
            {/* Starting balance */}
            <div className="bg-card border border-border/40 rounded-2xl p-3 flex items-center gap-3">
              <div className="p-2 bg-accent/10 rounded-xl shrink-0"><DollarSign className="w-4 h-4 text-accent" /></div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-foreground/60">Starting Balance</span>
                  {config.balanceOverride !== null ? (
                    <button onClick={() => setConfig(c => ({ ...c, balanceOverride: null }))}
                      className="text-[10px] flex items-center gap-0.5 text-accent/70 hover:text-accent transition-colors">
                      <X className="w-2.5 h-2.5" /> Live
                    </button>
                  ) : (
                    <button onClick={() => setConfig(c => ({ ...c, balanceOverride: netWorth }))}
                      className="text-[10px] flex items-center gap-0.5 text-foreground/30 hover:text-foreground/60 transition-colors">
                      <Edit2 className="w-2.5 h-2.5" /> Override
                    </button>
                  )}
                </div>
                {config.balanceOverride !== null ? (
                  <input autoFocus type="number" value={config.balanceOverride}
                    onChange={e => setConfig(c => ({ ...c, balanceOverride: parseFloat(e.target.value) || 0 }))}
                    className="w-full bg-background border border-border/50 rounded-lg px-2.5 py-1.5 text-sm text-foreground font-semibold" />
                ) : (
                  <div className="flex items-center gap-1.5">
                    <span className="text-lg font-bold text-foreground">{formatCurrency(netWorth)}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green/10 text-green/60">live ↗</span>
                  </div>
                )}
              </div>
            </div>

            {/* Monthly expenses */}
            <div className="bg-card border border-border/40 rounded-2xl p-3 flex items-center gap-3">
              <div className="p-2 bg-red/10 rounded-xl shrink-0"><Zap className="w-4 h-4 text-red" /></div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-foreground/60">Monthly Expenses</span>
                  {totalRecurringCharges > 0 && (
                    <span className="text-[10px] text-foreground/30">{(config.recurringCharges ?? []).length} items</span>
                  )}
                </div>
                {totalRecurringCharges > 0 ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-lg font-bold text-red">{formatCurrency(totalRecurringCharges)}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red/10 text-red/60">/mo</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-foreground/40 text-sm font-semibold">$</span>
                    <input type="number" value={config.monthlyExpenses || ""}
                      onChange={e => setConfig(c => ({ ...c, monthlyExpenses: parseFloat(e.target.value) || 0 }))}
                      placeholder="3500"
                      className="flex-1 bg-background border border-border/50 rounded-lg px-2.5 py-1.5 text-sm text-foreground font-semibold" />
                  </div>
                )}
              </div>
            </div>

            {/* Loan payments */}
            <div className="bg-card border border-border/40 rounded-2xl p-3 flex items-center gap-3">
              <div className="p-2 bg-accent/10 rounded-xl shrink-0"><Building className="w-4 h-4 text-accent" /></div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-foreground/60">Loan Payments</span>
                  {loans.length > 0 && (
                    <span className="text-[10px] text-foreground/30">{loans.length} loan{loans.length !== 1 ? "s" : ""}</span>
                  )}
                </div>
                {loans.length > 0 ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-lg font-bold text-accent">{formatCurrency(totalLoanPayments)}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/10 text-accent/60">/mo</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm text-foreground/30">No loans tracked</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Year stats (sidebar, visible on lg) */}
          <div className="hidden lg:flex flex-col gap-2 bg-card border border-border/40 rounded-2xl p-3">
            <span className="text-[10px] text-foreground/30 uppercase tracking-wider font-semibold">{viewYear} Summary</span>
            <div className="flex items-center gap-1.5 bg-green/10 border border-green/20 text-green px-3 py-1.5 rounded-xl text-xs font-medium">
              <TrendingUp className="w-3 h-3 shrink-0" />
              <span className="tabular-nums">+{formatCurrency(yearStats.income + yearStats.eventIncome)}</span>
            </div>
            <div className="flex items-center gap-1.5 bg-red/10 border border-red/20 text-red px-3 py-1.5 rounded-xl text-xs font-medium">
              <Zap className="w-3 h-3 shrink-0" />
              <span className="tabular-nums">−{formatCurrency(yearStats.expenses + Math.abs(yearStats.eventExpense))}</span>
            </div>
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border ${
              yearNetChange >= 0 ? "bg-green/10 border-green/20 text-green" : "bg-red/10 border-red/20 text-red"
            }`}>
              <span>{yearNetChange >= 0 ? "▲" : "▼"}</span>
              <span className="tabular-nums">{formatCurrency(Math.abs(yearNetChange))} net</span>
            </div>
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border ${
              yearStats.endBalance >= 0 ? "bg-accent/10 border-accent/20 text-accent" : "bg-red/10 border-red/20 text-red"
            }`}>
              <DollarSign className="w-3 h-3 shrink-0" />
              <span className="tabular-nums">{formatCurrency(yearStats.endBalance)} EOY</span>
            </div>
          </div>
        </div>

        {/* Main content: year nav + month grid */}
        <div className="order-1 lg:order-2 space-y-4">
          {/* Year nav bar */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4">
            {/* Arrow + year + quick-jump pills */}
            <div className="flex items-center gap-2 flex-wrap">
              {viewYear <= CUR_YEAR ? (
                <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-xl border border-dashed border-border/30 text-foreground/25 text-[10px] font-semibold uppercase tracking-wider select-none">
                  <ChevronLeft className="w-3 h-3" /> start
                </div>
              ) : (
                <button onClick={() => setViewYear(y => y - 1)}
                  className="p-2 bg-card hover:bg-card-hover border border-border/40 rounded-xl transition-colors">
                  <ChevronLeft className="w-4 h-4 text-foreground/60" />
                </button>
              )}
              <span className="text-lg font-bold text-accent w-12 text-center tabular-nums">{viewYear}</span>
              <button onClick={() => setViewYear(y => y + 1)} className="p-2 bg-card hover:bg-card-hover border border-border/40 rounded-xl transition-colors">
                <ChevronRight className="w-4 h-4 text-foreground/60" />
              </button>
              <div className="flex gap-1 ml-1 overflow-x-auto">
                {yearsWithData.map(y => (
                  <button key={y} onClick={() => setViewYear(y)}
                    className={`px-2 py-1 rounded-lg text-[11px] sm:text-xs font-medium transition-colors shrink-0 ${
                      viewYear === y ? "bg-accent text-white" : "bg-card text-foreground/40 hover:text-foreground border border-border/30"
                    }`}>{y}</button>
                ))}
              </div>
            </div>

            {/* Year stats (mobile only — shown inline) */}
            <div className="flex lg:hidden items-center gap-1.5 sm:gap-2 flex-wrap text-xs">
              <div className="flex items-center gap-1 sm:gap-1.5 bg-green/10 border border-green/20 text-green px-2 sm:px-3 py-1.5 rounded-xl font-medium">
                <TrendingUp className="w-3 h-3 shrink-0" />
                <span className="tabular-nums">+{formatCurrency(yearStats.income + yearStats.eventIncome)}</span>
              </div>
              <div className="flex items-center gap-1 sm:gap-1.5 bg-red/10 border border-red/20 text-red px-2 sm:px-3 py-1.5 rounded-xl font-medium">
                <Zap className="w-3 h-3 shrink-0" />
                <span className="tabular-nums">−{formatCurrency(yearStats.expenses + Math.abs(yearStats.eventExpense))}</span>
              </div>
              <div className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-xl font-medium border ${
                yearNetChange >= 0 ? "bg-green/10 border-green/20 text-green" : "bg-red/10 border-red/20 text-red"
              }`}>
                <span>{yearNetChange >= 0 ? "▲" : "▼"}</span>
                <span className="tabular-nums">{formatCurrency(Math.abs(yearNetChange))} net</span>
              </div>
              <div className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-xl font-medium border ${
                yearStats.endBalance >= 0 ? "bg-accent/10 border-accent/20 text-accent" : "bg-red/10 border-red/20 text-red"
              }`}>
                <DollarSign className="w-3 h-3 shrink-0" />
                <span className="tabular-nums">{formatCurrency(yearStats.endBalance)} EOY</span>
              </div>
            </div>
          </div>

          {/* Month grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
          {yearData.map((d, i) => {
            const eventsM     = config.events.filter(e => e.year === d.year && e.month === d.month);
            const vestEventsM     = allVestEvents.filter(e => e.year === d.year && e.month === d.month);
            const recurBonusM     = (config.recurringBonuses ?? []).filter(b => b.month === d.month && b.startYear <= d.year && (b.endYear === null || b.endYear >= d.year));
            const scenarioEventsM = (config.scenarioEvents ?? []).filter(s => s.year === d.year && s.month === d.month);
            const isPast  = d.year < CUR_YEAR || (d.year === CUR_YEAR && d.month < CUR_MONTH);
            const isToday = d.year === CUR_YEAR && d.month === CUR_MONTH;
            const netSalary = computeMonthlyNet(d.salary * 12, taxFilingStatus);
            return (
              <MonthCard
                key={i}
                year={d.year} month={d.month}
                salary={d.salary} netSalary={netSalary} monthlyExpenses={isToday
                  ? Math.max(0, (totalRecurringCharges > 0 ? totalRecurringCharges : config.monthlyExpenses) - paidChargesTotal)
                  : (totalRecurringCharges > 0 ? totalRecurringCharges : config.monthlyExpenses)}
                events={eventsM} vestEvents={vestEventsM} recurBonuses={recurBonusM}
                scenarioEvents={scenarioEventsM}
                loanPaymentsTotal={getLoanPaymentsForMonth(d.year, d.month)}
                balance={d.balance} net={d.net}
                isPast={isPast} isToday={isToday}
                onAddEvent={addEvent} onRemoveEvent={removeEvent}
              />
            );
          })}
        </div>
        </div>
      </div>

      {/* ── Advanced Settings (collapsed) ── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 px-1">
          <div className="h-px flex-1 bg-border/30" />
          <span className="text-xs text-foreground/30 font-medium uppercase tracking-wider">Tax Estimator</span>
          <div className="h-px flex-1 bg-border/30" />
        </div>

        {/* WA Tax Estimator */}
        <Accordion
          title="Washington State Tax Estimator"
          icon={<div className="p-2.5 bg-rose-500/15 rounded-xl"><Calculator className="w-5 h-5 text-rose-400" /></div>}
          subtitle="— federal + FICA + WA Cares Fund (no state income tax)"
          gradient="from-rose-500/10 to-rose-500/5"
        >
          {/* Controls */}
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-foreground/40 uppercase tracking-wide">Filing status</label>
              <div className="flex gap-1">
                {(["single","mfj","mfs","hoh"] as const).map(s => (
                  <button key={s} onClick={() => { setTaxFilingStatus(s); savePlanner({ tax_filing_status: s }); }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                      taxFilingStatus === s ? "bg-accent text-white" : "bg-card border border-border/40 text-foreground/50 hover:text-foreground"
                    }`}>
                    {{ single: "Single", mfj: "MFJ", mfs: "MFS", hoh: "HoH" }[s]}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-foreground/40 uppercase tracking-wide">Annual gross income</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={taxIncomeOverride}
                  onChange={e => setTaxIncomeOverride(e.target.value)}
                  placeholder={String(Math.round(
                    (() => { let s = 0; for (let m = 1; m <= 12; m++) s += getSalaryForMonth(config.salaryPeriods, CUR_YEAR, m); return s; })()
                  ) || "e.g. 120000")}
                  className="bg-card border border-border/50 rounded-lg px-2.5 py-1.5 text-xs text-foreground w-36 placeholder-foreground/25"
                />
                {taxIncomeOverride && (
                  <button onClick={() => setTaxIncomeOverride("")}
                    className="text-foreground/30 hover:text-foreground transition-colors text-[10px]">← salary</button>
                )}
              </div>
            </div>
          </div>

          {taxEstimate ? (
            <div className="space-y-3 mt-1">
              {/* Hero: monthly take-home */}
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl px-4 py-4 sm:px-5 flex items-center justify-between gap-3 sm:gap-4">
                <div>
                  <div className="text-[10px] text-emerald-400/60 uppercase tracking-wider font-semibold mb-1">Monthly take-home (salary)</div>
                  <div className="text-3xl font-bold text-emerald-400 tabular-nums">{formatCurrency(taxEstimate.monthlySalaryNet)}</div>
                  <div className="text-xs text-foreground/40 mt-1">
                    from {formatCurrency(taxEstimate.monthlyGross)}/mo gross
                    {!taxIncomeOverride && taxEstimate.annualBonuses > 0 && (
                      <span className="ml-2 text-amber-400/70">+ {formatCurrency(taxEstimate.annualBonuses)} bonus/yr</span>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[10px] text-foreground/40 uppercase tracking-wider mb-1">Effective rate</div>
                  <div className="text-xl font-bold text-rose-400">{(taxEstimate.effectiveRate * 100).toFixed(1)}%</div>
                  <div className="text-[10px] text-foreground/30">marginal {(taxEstimate.marginal * 100).toFixed(0)}%</div>
                </div>
              </div>

              {/* Annual summary row */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <div className="flex flex-col gap-0.5 bg-card border border-border/40 rounded-xl px-3 py-2.5">
                  <span className="text-[10px] text-foreground/40 uppercase tracking-wider">Annual gross</span>
                  <span className="text-sm font-bold text-foreground tabular-nums">{formatCurrency(taxEstimate.annualGross)}</span>
                  {!taxIncomeOverride && taxEstimate.annualBonuses > 0 && (
                    <span className="text-[10px] text-foreground/30 tabular-nums">
                      salary {formatCurrency(taxEstimate.annualSalary)} + bonus {formatCurrency(taxEstimate.annualBonuses)}
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-0.5 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2.5">
                  <span className="text-[10px] text-rose-400/70 uppercase tracking-wider">Total tax / yr</span>
                  <span className="text-sm font-bold text-rose-400 tabular-nums">{formatCurrency(taxEstimate.total)}</span>
                  <span className="text-[10px] text-rose-400/50 tabular-nums">{formatCurrency(taxEstimate.total / 12)}/mo avg</span>
                </div>
                <div className="flex flex-col gap-0.5 bg-card border border-border/40 rounded-xl px-3 py-2.5 col-span-2 sm:col-span-1">
                  <span className="text-[10px] text-foreground/40 uppercase tracking-wider">Take-home / yr</span>
                  <span className="text-sm font-bold text-foreground tabular-nums">{formatCurrency(taxEstimate.net)}</span>
                </div>
              </div>

              {/* Breakdown rows */}
              <div className="rounded-xl border border-border/30 overflow-hidden">
                <div className="bg-background/40 px-4 py-2 border-b border-border/20">
                  <span className="text-[10px] text-foreground/35 uppercase tracking-wider font-semibold">Tax breakdown — {viewYear} income</span>
                </div>
                <div className="divide-y divide-border/15">
                  {/* Federal income tax — header row */}
                  <div className="flex items-center gap-3 px-4 py-2.5">
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-medium text-rose-400">Federal income tax</span>
                      <span className="text-[10px] text-foreground/30 ml-2">marginal {(taxEstimate.marginal * 100).toFixed(0)}% · taxable {formatCurrency(taxEstimate.taxable)}</span>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs font-bold tabular-nums text-rose-400">−{formatCurrency(taxEstimate.federal)}/yr</div>
                      <div className="text-[10px] text-foreground/30 tabular-nums">−{formatCurrency(taxEstimate.federal / 12)}/mo</div>
                    </div>
                  </div>
                  {/* Federal bracket detail rows */}
                  {taxEstimate.federalBrackets.map(b => (
                    <div key={b.rate} className="flex items-center gap-3 pl-8 pr-4 py-1.5 bg-rose-500/5">
                      <div className="flex-1 min-w-0 flex items-center gap-1.5">
                        <span className="text-[10px] font-semibold text-rose-300/70 tabular-nums w-7">{(b.rate * 100).toFixed(0)}%</span>
                        <span className="text-[10px] text-foreground/30 tabular-nums">
                          {formatCurrency(b.taxed)} taxed
                          <span className="mx-1 opacity-40">·</span>
                          {formatCurrency(b.from)}{b.to ? `–${formatCurrency(b.to)}` : "+"} bracket
                        </span>
                      </div>
                      <div className="text-[10px] font-semibold tabular-nums text-rose-300/70">−{formatCurrency(b.tax)}</div>
                    </div>
                  ))}
                  {/* Other FICA rows */}
                  {[
                    { label: "Social Security",        color: "text-orange-400",  val: taxEstimate.ss,       note: "6.2% up to $176,100" },
                    { label: "Medicare",               color: "text-amber-400",   val: taxEstimate.medicare, note: "1.45% + 0.9% above threshold" },
                    { label: "WA Cares Fund (LTC)",    color: "text-blue-400",    val: taxEstimate.waCares,  note: "0.58% of wages" },
                  ].map(row => (
                    <div key={row.label} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="flex-1 min-w-0">
                        <span className={`text-xs font-medium ${row.color}`}>{row.label}</span>
                        <span className="text-[10px] text-foreground/30 ml-2">{row.note}</span>
                      </div>
                      <div className="text-right shrink-0">
                        <div className={`text-xs font-bold tabular-nums ${row.color}`}>−{formatCurrency(row.val)}/yr</div>
                        <div className="text-[10px] text-foreground/30 tabular-nums">−{formatCurrency(row.val / 12)}/mo</div>
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center gap-3 px-4 py-2.5 bg-emerald-500/5">
                    <div className="flex-1">
                      <span className="text-xs font-medium text-emerald-400">WA State income tax</span>
                      <span className="text-[10px] text-foreground/30 ml-2">Washington has no state income tax 🎉</span>
                    </div>
                    <div className="text-xs font-bold text-emerald-400 tabular-nums">$0.00</div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-foreground/40 py-2">Set a salary period or enter an annual income above to estimate taxes.</p>
          )}
        </Accordion>

        <div className="flex items-center gap-2 px-1">
          <div className="h-px flex-1 bg-border/30" />
          <span className="text-xs text-foreground/30 font-medium uppercase tracking-wider">Income, Expenses &amp; Bonuses</span>
          <div className="h-px flex-1 bg-border/30" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Recurring Charges */}
        <Accordion
          title="Recurring Charges"
          icon={<div className="p-2.5 bg-red/15 rounded-xl"><Zap className="w-5 h-5 text-red" /></div>}
          subtitle="— rent, subscriptions, bills, debt payments"
          gradient="from-red/10 to-red/5"
          defaultOpen={(config.recurringCharges ?? []).length === 0}
        >
          {/* Charge list */}
          {(config.recurringCharges ?? []).length > 0 && (
            <div className="space-y-1.5">
              {(config.recurringCharges ?? []).map(rc => {
                const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
                const rcKey = norm(rc.label);
                const seenThisMonth = [...thisMonthTxKeys].some(k => k.includes(rcKey) || rcKey.includes(k));
                return (
                  <div key={rc.id} className={`group flex items-center gap-3 rounded-xl px-4 py-3 border transition-colors ${
                    seenThisMonth ? "bg-green/5 border-green/20" : "bg-card border-border/40 hover:border-border/70"
                  }`}>
                    <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${seenThisMonth ? "bg-green" : "bg-red-light"}`} />
                    <div className="flex-1 min-w-0 text-sm text-foreground font-medium truncate">{rc.label}</div>
                    {seenThisMonth && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green/10 text-green/70 font-semibold shrink-0">paid</span>
                    )}
                    <div className={`text-sm font-semibold shrink-0 tabular-nums ${seenThisMonth ? "text-foreground/40" : "text-red"}`}>
                      −{formatCurrency(rc.amount)}<span className="text-foreground/45 font-normal text-xs ml-0.5">/mo</span>
                    </div>
                    <button
                      onClick={() => setConfig(c => ({ ...c, recurringCharges: (c.recurringCharges ?? []).filter(x => x.id !== rc.id) }))}
                      className="opacity-0 group-hover:opacity-100 text-foreground/30 hover:text-red transition-all shrink-0">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
              <div className="flex items-center justify-between px-4 py-2 mt-0.5 border-t border-border/20">
                <span className="text-[11px] text-foreground/50 uppercase tracking-wider font-medium">Monthly total</span>
                <span className="font-bold text-red text-sm tabular-nums">−{formatCurrency(totalRecurringCharges)}</span>
              </div>
            </div>
          )}
          {(config.recurringCharges ?? []).length === 0 && !scanned && (
            <p className="text-xs text-foreground/40 text-center py-2">No charges yet — scan your transactions or add one manually.</p>
          )}

          {/* Add charge form */}
          {addingCharge ? (
            <div className="flex flex-wrap items-end gap-3 bg-background/60 border border-border/30 rounded-xl p-4">
              <div className="flex flex-col gap-1 flex-1 min-w-32">
                <label className="text-[10px] text-foreground/40 uppercase tracking-wide">Label</label>
                <input autoFocus value={newCharge.label} onChange={e => setNewCharge(f => ({ ...f, label: e.target.value }))}
                  onKeyDown={e => e.key === "Enter" && addRecurringCharge()}
                  placeholder="e.g. Rent" className="bg-card border border-border/50 rounded-lg px-2.5 py-1.5 text-xs text-foreground placeholder-foreground/25" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-foreground/40 uppercase tracking-wide">Amount / mo</label>
                <input type="number" value={newCharge.amount || ""} onChange={e => setNewCharge(f => ({ ...f, amount: parseFloat(e.target.value) || 0 }))}
                  onKeyDown={e => e.key === "Enter" && addRecurringCharge()}
                  placeholder="0.00" className="bg-card border border-border/60 rounded-lg px-2.5 py-1.5 text-xs text-foreground w-28 placeholder-foreground/30" />
              </div>
              <div className="flex gap-2">
                <button onClick={addRecurringCharge} className="flex items-center gap-1.5 px-4 py-1.5 bg-accent hover:bg-accent/90 text-white text-xs rounded-lg font-semibold transition-colors shadow-sm">
                  <Check className="w-3 h-3" /> Save
                </button>
                <button onClick={() => { setAddingCharge(false); setNewCharge({ label: "", amount: 0, category: "other" }); }}
                  className="px-3 py-1.5 bg-card hover:bg-card-hover text-foreground/60 hover:text-foreground text-xs rounded-lg border border-border/40 hover:border-border/60 transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setAddingCharge(true)}
              className="flex items-center gap-1 text-xs text-accent-light hover:text-accent transition-colors w-fit">
              <Plus className="w-3 h-3" /> Add charge
            </button>
          )}

          {/* Scanner */}
          <div className="rounded-xl border border-border/30 overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 py-3 bg-background/40">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className={`p-1.5 rounded-lg ${scanning ? "bg-accent/20" : "bg-background/80 border border-border/30"}`}>
                  <ScanSearch className={`w-3.5 h-3.5 ${scanning ? "text-accent animate-pulse" : "text-foreground/40"}`} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-foreground/60">Auto-detect from transactions</p>
                  <p className="text-[10px] text-foreground/30 mt-0.5 leading-tight">Finds charges that repeat each month at the same amount</p>
                </div>
              </div>
              <button onClick={scanTransactions} disabled={scanning}
                className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg font-semibold transition-all disabled:opacity-50 ${
                  scanning
                    ? "bg-accent/10 text-accent cursor-wait"
                    : scanned
                    ? "bg-background/60 border border-border/40 text-foreground/50 hover:text-foreground hover:border-border/70"
                    : "bg-accent text-white hover:bg-accent/90 shadow-sm"
                }`}>
                <ScanSearch className="w-3 h-3" />
                {scanning ? "Scanning…" : scanned ? "Re-scan" : "Scan now"}
              </button>
            </div>

            {/* Suggestions */}
            {scanned && (() => {
              const visible = suggestions.filter(s => !dismissedKeys.has(s.key));
              if (visible.length === 0) return (
                <div className="px-4 py-3 border-t border-border/20 bg-background/20">
                  <p className="text-xs text-foreground/30 text-center">✓ No new recurring charges found</p>
                </div>
              );
              return (
                <div className="border-t border-border/20">
                  <div className="px-4 py-2 bg-amber-500/5 border-b border-amber-500/10">
                    <p className="text-[10px] text-amber-400/70 font-semibold uppercase tracking-wider">{visible.length} suggestion{visible.length > 1 ? "s" : ""} found</p>
                  </div>
                  <div className="divide-y divide-border/15">
                    {visible.map(s => (
                      <div key={s.key} className="flex items-center gap-3 px-4 py-2.5 hover:bg-background/40 transition-colors">
                        <div className="flex-1 min-w-0">
                          <span className="text-sm text-foreground/85 font-medium truncate block leading-tight">{s.label}</span>
                          <span className="text-[10px] text-foreground/30">{s.monthCount} months in a row</span>
                        </div>
                        <span className="text-red font-bold text-sm shrink-0 tabular-nums">−{formatCurrency(s.amount)}<span className="text-foreground/25 font-normal text-[10px]">/mo</span></span>
                        <button onClick={() => acceptSuggestion(s)}
                          className="shrink-0 flex items-center gap-1 px-2.5 py-1 bg-green/10 hover:bg-green/20 text-green rounded-lg text-[11px] font-semibold transition-colors">
                          <Plus className="w-3 h-3" /> Add
                        </button>
                        <button onClick={() => dismissSuggestion(s.key)}
                          className="shrink-0 p-1.5 text-foreground/20 hover:text-foreground/50 rounded-lg transition-colors" title="Dismiss">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        </Accordion>

        {/* Income Schedule */}
        <Accordion
          title="Income Schedule"
          icon={<div className="p-2.5 bg-green/15 rounded-xl"><TrendingUp className="w-5 h-5 text-green" /></div>}
          subtitle="— salary periods, promotions, job changes"
          gradient="from-green/10 to-green/5"
        >
          {config.salaryPeriods.length === 0 && !addingSalary && (
            <p className="text-xs text-foreground/40 text-center py-2">No salary periods yet. Add your current salary to start projecting.</p>
          )}
          <div className="space-y-1.5">
            {config.salaryPeriods.map((sp, idx) => (
              <div key={sp.id} className={`group flex items-center gap-3 rounded-xl px-4 py-3 border transition-colors ${
                editingId === sp.id
                  ? "bg-card border-border/60"
                  : "bg-card border-border/40 hover:border-border/70"
              }`}>
                {editingId === sp.id ? (
                  <>
                    <input value={salaryDraft.label ?? sp.label} onChange={e => setSalaryDraft(d => ({ ...d, label: e.target.value }))}
                      placeholder="Label" className="flex-1 min-w-0 bg-background border border-border/50 rounded-lg px-2.5 py-1 text-xs text-foreground" />
                    <select value={salaryDraft.startMonth ?? sp.startMonth} onChange={e => setSalaryDraft(d => ({ ...d, startMonth: parseInt(e.target.value) }))}
                      className="bg-background border border-border/50 rounded-lg px-2.5 py-1 text-xs text-foreground shrink-0">
                      {MONTHS_FULL.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                    </select>
                    <input type="number" value={salaryDraft.startYear ?? sp.startYear}
                      onChange={e => setSalaryDraft(d => ({ ...d, startYear: parseInt(e.target.value) }))}
                      className="w-20 shrink-0 bg-background border border-border/50 rounded-lg px-2.5 py-1 text-xs text-foreground" />
                    <input type="number" value={salaryDraft.monthlySalary ?? sp.monthlySalary}
                      onChange={e => setSalaryDraft(d => ({ ...d, monthlySalary: parseFloat(e.target.value) || 0 }))}
                      placeholder="/mo" className="w-28 shrink-0 bg-background border border-border/50 rounded-lg px-2.5 py-1 text-xs text-foreground" />
                    <button onClick={() => saveSalaryEdit(sp.id)} className="text-green hover:text-green-300 shrink-0"><Check className="w-4 h-4" /></button>
                    <button onClick={() => setEditingId(null)} className="text-foreground/30 hover:text-foreground shrink-0"><X className="w-4 h-4" /></button>
                  </>
                ) : (
                  <>
                    <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${idx === 0 ? "bg-green" : "bg-green-light"}`} />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-foreground font-medium">{sp.label || "Salary period"}</span>
                      <span className="text-[11px] text-foreground/50 ml-2">from {MONTHS_FULL[sp.startMonth - 1]} {sp.startYear}</span>
                    </div>
                    <span className="text-green font-semibold text-sm shrink-0 tabular-nums">
                      +{formatCurrency(sp.monthlySalary)}<span className="text-foreground/45 font-normal text-xs ml-0.5">/mo</span>
                    </span>
                    <button onClick={() => { setEditingId(sp.id); setSalaryDraft({ ...sp }); }}
                      className="opacity-0 group-hover:opacity-100 text-foreground/40 hover:text-foreground transition-all shrink-0"><Edit2 className="w-3.5 h-3.5" /></button>
                    {config.salaryPeriods.length > 1 && (
                      <button onClick={() => setConfig(c => ({ ...c, salaryPeriods: c.salaryPeriods.filter(s => s.id !== sp.id) }))}
                        className="opacity-0 group-hover:opacity-100 text-foreground/40 hover:text-red transition-all shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>

          {addingSalary ? (
            <div className="flex flex-wrap items-end gap-3 bg-background/60 border border-border/30 rounded-xl p-4">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-foreground/40 uppercase tracking-wide">Label</label>
                <input autoFocus value={newSP.label} onChange={e => setNewSP(f => ({ ...f, label: e.target.value }))}
                  placeholder="e.g. After promotion" className="bg-card border border-border/50 rounded-lg px-2.5 py-1.5 text-xs text-foreground placeholder-foreground/25 w-40" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-foreground/40 uppercase tracking-wide">Starting month</label>
                <select value={newSP.startMonth} onChange={e => setNewSP(f => ({ ...f, startMonth: parseInt(e.target.value) }))}
                  className="bg-card border border-border/60 rounded-lg px-2.5 py-1.5 text-xs text-foreground">
                  {MONTHS_FULL.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-foreground/40 uppercase tracking-wide">Year</label>
                <input type="number" value={newSP.startYear} onChange={e => setNewSP(f => ({ ...f, startYear: parseInt(e.target.value) || CUR_YEAR }))}
                  className="bg-card border border-border/60 rounded-lg px-2.5 py-1.5 text-xs text-foreground w-20" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-foreground/40 uppercase tracking-wide">Monthly salary</label>
                <input type="number" value={newSP.monthlySalary || ""} onChange={e => setNewSP(f => ({ ...f, monthlySalary: parseFloat(e.target.value) || 0 }))}
                  placeholder="5000" className="bg-card border border-border/50 rounded-lg px-2.5 py-1.5 text-xs text-foreground placeholder-foreground/25 w-28" />
              </div>
              <div className="flex gap-2">
                <button onClick={addSalaryPeriod} className="flex items-center gap-1.5 px-4 py-1.5 bg-accent hover:bg-accent/90 text-white text-xs rounded-lg font-semibold transition-colors shadow-sm">
                  <Check className="w-3 h-3" /> Save
                </button>
                <button onClick={() => setAddingSalary(false)} className="px-3 py-1.5 bg-card hover:bg-card-hover text-foreground/60 hover:text-foreground text-xs rounded-lg border border-border/40 hover:border-border/60 transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setAddingSalary(true)}
              className="flex items-center gap-1 text-xs text-accent-light hover:text-accent transition-colors w-fit">
              <Plus className="w-3 h-3" /> Add salary period
            </button>
          )}
        </Accordion>

        {/* Stock Vesting Grants */}
        <Accordion
          title="Stock Vesting Grants"
          icon={<div className="p-2.5 bg-indigo/15 rounded-xl"><BarChart2 className="w-5 h-5 text-indigo" /></div>}
          subtitle="— RSUs, options, ESPP"
          gradient="from-indigo/10 to-indigo/5"
        >
          {/* Stock summary bar */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 bg-card border border-border/40 rounded-xl px-4 py-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-foreground/50 uppercase tracking-wider font-medium">Holdings</span>
              <span className="text-sm font-semibold text-foreground tabular-nums">{formatCurrency(stockTotal)}</span>
            </div>
            <span className="text-foreground/30 text-sm font-light">+</span>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-foreground/50 uppercase tracking-wider font-medium">Grants</span>
              <span className="text-sm font-semibold text-indigo tabular-nums">{formatCurrency((config.vestingGrants ?? []).reduce((s, g) => s + g.totalValue, 0))}</span>
            </div>
            <span className="text-foreground/30 text-sm font-light">=</span>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-foreground/50 uppercase tracking-wider font-medium">Stock total</span>
              <span className="text-sm font-bold text-indigo-300 tabular-nums">{formatCurrency(stockTotal + (config.vestingGrants ?? []).reduce((s, g) => s + g.totalValue, 0))}</span>
            </div>
          </div>

          {(config.vestingGrants ?? []).length === 0 && !addingVest && (
            <p className="text-xs text-foreground/40 text-center py-2">No grants yet. Add your RSU or stock option grants.</p>
          )}
          <div className="space-y-1.5">
            {(config.vestingGrants ?? []).map(g => {
              const vestDates = g.vestOffsets.map(off => {
                const tot = (g.hireMonth - 1) + off;
                return `${MONTHS_SHORT[(tot % 12)]} ${g.hireYear + Math.floor(tot / 12)}`;
              });
              return (
                <div key={g.id} className="group flex items-start gap-3 rounded-xl px-4 py-3 bg-card border border-border/40 hover:border-border/70 transition-colors">
                  <div className="w-2.5 h-2.5 rounded-full bg-indigo-light shrink-0 mt-1" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-foreground">{g.label}</span>
                      <span className="text-[11px] text-foreground/50">hired {MONTHS_SHORT[g.hireMonth-1]} {g.hireYear}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {vestDates.map((d, i) => (
                        <span key={i} className="bg-indigo/15 text-indigo-300 text-[10px] px-2 py-0.5 rounded-md font-medium">
                          {formatCurrency(g.totalValue / g.vestOffsets.length)} · {d}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-indigo font-semibold text-sm tabular-nums">{formatCurrency(g.totalValue)}<span className="text-foreground/45 font-normal text-xs ml-0.5">total</span></span>
                    <button onClick={() => setConfig(c => ({ ...c, vestingGrants: (c.vestingGrants ?? []).filter(v => v.id !== g.id) }))}
                      className="opacity-0 group-hover:opacity-100 text-foreground/30 hover:text-red transition-all"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              );
            })}
          </div>

          {addingVest ? (
            <div className="space-y-3 bg-background/60 border border-border/30 rounded-xl p-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1 col-span-2 sm:col-span-1">
                  <label className="text-[10px] text-foreground/40 uppercase tracking-wide">Grant label</label>
                  <input autoFocus value={newVest.label} onChange={e => setNewVest(f => ({ ...f, label: e.target.value }))}
                    placeholder="e.g. Initial RSU Grant" className="bg-card border border-border/50 rounded-lg px-2.5 py-1.5 text-xs text-foreground placeholder-foreground/25" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-foreground/40 uppercase tracking-wide">Total value ($)</label>
                  <input type="number" value={newVest.totalValue || ""} onChange={e => setNewVest(f => ({ ...f, totalValue: parseFloat(e.target.value) || 0 }))}
                    placeholder="50000" className="bg-card border border-border/50 rounded-lg px-2.5 py-1.5 text-xs text-foreground placeholder-foreground/25" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-foreground/40 uppercase tracking-wide">Hire month</label>
                  <select value={newVest.hireMonth} onChange={e => setNewVest(f => ({ ...f, hireMonth: parseInt(e.target.value) }))}
                    className="bg-card border border-border/60 rounded-lg px-2.5 py-1.5 text-xs text-foreground">
                    {MONTHS_FULL.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-foreground/40 uppercase tracking-wide">Hire year</label>
                  <input type="number" value={newVest.hireYear} onChange={e => setNewVest(f => ({ ...f, hireYear: parseInt(e.target.value) || CUR_YEAR }))}
                    className="bg-card border border-border/60 rounded-lg px-2.5 py-1.5 text-xs text-foreground w-full" />
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-[10px] text-foreground/40 uppercase tracking-wide">Vest schedule (months after hire)</label>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] text-foreground/30">Presets:</span>
                  {[[6,18,30],[12,24,36],[6,12,18,24,30,36]].map((preset, pi) => (
                    <button key={pi} onClick={() => setNewVest(f => ({ ...f, vestOffsets: preset }))}
                      className="text-xs px-2.5 py-1 rounded-lg border border-border/40 text-foreground/40 hover:border-indigo-400/40 hover:text-indigo transition-colors">
                      {preset.map(o => `+${o}mo`).join(", ")}
                    </button>
                  ))}
                  <button onClick={() => setNewVest(f => ({ ...f, vestOffsets: [] }))}
                    className="text-xs px-2 py-1 rounded-lg border border-border/30 text-foreground/25 hover:border-red-400/40 hover:text-red transition-colors">Clear</button>
                </div>
                {newVest.vestOffsets.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap">
                    {[...newVest.vestOffsets].sort((a, b) => a - b).map((off, i) => (
                      <span key={i} className="flex items-center gap-1 bg-indigo/15 text-indigo text-xs px-2 py-0.5 rounded-lg">
                        +{off}mo
                        <button onClick={() => setNewVest(f => ({ ...f, vestOffsets: f.vestOffsets.filter(v => v !== off) }))}
                          className="hover:text-red transition-colors ml-0.5"><X className="w-2.5 h-2.5" /></button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex gap-1.5">
                  <input type="number" min={1} value={vestOffsetInput} onChange={e => setVestOffsetInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { const mo = parseInt(vestOffsetInput); if (mo > 0 && !newVest.vestOffsets.includes(mo)) { setNewVest(f => ({ ...f, vestOffsets: [...f.vestOffsets, mo].sort((a, b) => a - b) })); setVestOffsetInput(""); } } }}
                    placeholder="Custom month, e.g. 18" className="flex-1 bg-card border border-border/50 rounded-lg px-2.5 py-1.5 text-xs text-foreground placeholder-foreground/25" />
                  <button onClick={() => { const mo = parseInt(vestOffsetInput); if (mo > 0 && !newVest.vestOffsets.includes(mo)) { setNewVest(f => ({ ...f, vestOffsets: [...f.vestOffsets, mo].sort((a, b) => a - b) })); setVestOffsetInput(""); } }}
                    className="px-3 py-1.5 bg-indigo/15 hover:bg-indigo/25 text-indigo text-xs rounded-lg transition-colors font-medium whitespace-nowrap">+ Add</button>
                </div>
                <p className="text-[10px] text-foreground/30">
                  {newVest.vestOffsets.length} vest{newVest.vestOffsets.length !== 1 ? "s" : ""} · {formatCurrency(newVest.totalValue / (newVest.vestOffsets.length || 1))} each
                </p>
              </div>
              <div className="flex gap-2">
                <button onClick={addVestingGrant} className="flex items-center gap-1.5 px-4 py-1.5 bg-indigo hover:bg-indigo-light text-white text-xs rounded-lg font-semibold transition-colors shadow-sm">
                  <Check className="w-3 h-3" /> Save grant
                </button>
                <button onClick={() => { setAddingVest(false); setVestOffsetInput(""); }} className="px-3 py-1.5 bg-card hover:bg-card-hover text-foreground/60 hover:text-foreground text-xs rounded-lg border border-border/50 transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setAddingVest(true)}
              className="flex items-center gap-1 text-xs text-accent-light hover:text-accent transition-colors w-fit">
              <Plus className="w-3 h-3" /> Add grant
            </button>
          )}
        </Accordion>

        {/* Recurring Bonuses */}
        <Accordion
          title="Recurring Bonuses"
          icon={<div className="p-2.5 bg-pink/15 rounded-xl"><Sparkles className="w-5 h-5 text-pink" /></div>}
          subtitle="— annual bonus, profit share, etc."
          gradient="from-pink/10 to-pink/5"
        >
          {(config.recurringBonuses ?? []).length === 0 && !addingBonus && (
            <p className="text-xs text-foreground/40 text-center py-2">No recurring bonuses. Model your annual bonus or profit share range.</p>
          )}
          <div className="space-y-1.5">
            {(config.recurringBonuses ?? []).map(b => (
              <div key={b.id} className="group flex items-center gap-3 rounded-xl px-4 py-3 bg-card border border-border/40 hover:border-border/70 transition-colors">
                <div className="w-2.5 h-2.5 rounded-full bg-pink-light shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-foreground">{b.label}</span>
                  <span className="text-[11px] text-foreground/50 ml-2">every {MONTHS_FULL[b.month-1]} · {b.startYear}{b.endYear ? `–${b.endYear}` : "+"}</span>
                </div>
                <span className="text-pink font-semibold text-sm shrink-0 tabular-nums">
                  {b.amountType === "pct_salary"
                    ? b.amountMin === b.amountMax ? `${b.amountMin}% salary` : `${b.amountMin}–${b.amountMax}% salary`
                    : b.amountMin === b.amountMax ? formatCurrency(b.amountMin) : `${formatCurrency(b.amountMin)}–${formatCurrency(b.amountMax)}`}
                </span>
                <button onClick={() => setConfig(c => ({ ...c, recurringBonuses: (c.recurringBonuses ?? []).filter(rb => rb.id !== b.id) }))}
                  className="opacity-0 group-hover:opacity-100 text-foreground/30 hover:text-red transition-all shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>

          {addingBonus ? (
            <div className="space-y-3 bg-background/60 border border-border/30 rounded-xl p-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1 col-span-2 sm:col-span-1">
                  <label className="text-[10px] text-foreground/40 uppercase tracking-wide">Label</label>
                  <input autoFocus value={newBonus.label} onChange={e => setNewBonus(f => ({ ...f, label: e.target.value }))}
                    placeholder="e.g. Annual September Bonus" className="bg-card border border-border/50 rounded-lg px-2.5 py-1.5 text-xs text-foreground placeholder-foreground/25" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-foreground/40 uppercase tracking-wide">Month paid</label>
                  <select value={newBonus.month} onChange={e => setNewBonus(f => ({ ...f, month: parseInt(e.target.value) }))}
                    className="bg-card border border-border/50 rounded-lg px-2.5 py-1.5 text-xs text-foreground">
                    {MONTHS_FULL.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-foreground/40 uppercase tracking-wide">Amount type</label>
                  <select value={newBonus.amountType} onChange={e => setNewBonus(f => ({ ...f, amountType: e.target.value as BonusAmountType }))}
                    className="bg-card border border-border/50 rounded-lg px-2.5 py-1.5 text-xs text-foreground">
                    <option value="pct_salary">% of Salary</option>
                    <option value="fixed">Fixed $</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-foreground/40 uppercase tracking-wide">Min {newBonus.amountType === "pct_salary" ? "%" : "$"}</label>
                  <input type="number" value={newBonus.amountMin} onChange={e => setNewBonus(f => ({ ...f, amountMin: parseFloat(e.target.value) || 0 }))}
                    placeholder="5" className="bg-card border border-border/50 rounded-lg px-2.5 py-1.5 text-xs text-foreground placeholder-foreground/25" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-foreground/40 uppercase tracking-wide">Max {newBonus.amountType === "pct_salary" ? "%" : "$"}</label>
                  <input type="number" value={newBonus.amountMax} onChange={e => setNewBonus(f => ({ ...f, amountMax: parseFloat(e.target.value) || 0 }))}
                    placeholder="15" className="bg-card border border-border/50 rounded-lg px-2.5 py-1.5 text-xs text-foreground placeholder-foreground/25" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-foreground/40 uppercase tracking-wide">Start year</label>
                  <input type="number" value={newBonus.startYear} onChange={e => setNewBonus(f => ({ ...f, startYear: parseInt(e.target.value) || CUR_YEAR }))}
                    className="bg-card border border-border/50 rounded-lg px-2.5 py-1.5 text-xs text-foreground" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-foreground/40 uppercase tracking-wide">End year (blank = forever)</label>
                  <input type="number" value={newBonus.endYear ?? ""} onChange={e => setNewBonus(f => ({ ...f, endYear: e.target.value ? parseInt(e.target.value) : null }))}
                    placeholder="ongoing" className="bg-card border border-border/50 rounded-lg px-2.5 py-1.5 text-xs text-foreground placeholder-foreground/25" />
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={addRecurringBonus} className="flex items-center gap-1.5 px-4 py-1.5 bg-accent hover:bg-accent/90 text-white text-xs rounded-lg font-semibold transition-colors shadow-sm">
                  <Check className="w-3 h-3" /> Save bonus
                </button>
                <button onClick={() => setAddingBonus(false)} className="px-3 py-1.5 bg-card hover:bg-card-hover text-foreground/60 hover:text-foreground text-xs rounded-lg border border-border/40 hover:border-border/60 transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setAddingBonus(true)}
              className="flex items-center gap-1 text-xs text-accent-light hover:text-accent transition-colors w-fit">
              <Plus className="w-3 h-3" /> Add bonus
            </button>
          )}
        </Accordion>

        {/* ── Loan Payments ── */}
        <Accordion
          title="Loan Payments"
          icon={<div className="p-2.5 bg-accent/15 rounded-xl"><Building className="w-4 h-4 text-accent" /></div>}
          gradient="from-accent/10 to-indigo/5"
        >
          {loans.length === 0 ? (
            <p className="text-sm text-foreground/40 py-2">No loans tracked yet. Add loans in the main dashboard.</p>
          ) : (
            <div className="space-y-1.5">
              {loans.map(loan => {
                const paid = paidLoanIds.has(loan.id);
                return (
                  <div key={loan.id} className={`flex items-center gap-3 rounded-xl px-4 py-3 border transition-colors ${
                    paid
                      ? "bg-green/5 border-green/20"
                      : "bg-card border-border/40 hover:border-border/60"
                  }`}>
                    <div className={`w-2 h-2 rounded-full shrink-0 ${paid ? "bg-green" : "bg-accent/50"}`} />
                    <div className="flex-1 min-w-0">
                      <span className={`text-sm font-medium truncate block ${paid ? "text-foreground/40 line-through" : "text-foreground/80"}`}>{loan.name}</span>
                      <span className="text-[10px] text-foreground/30 capitalize">{loan.type}</span>
                    </div>
                    <span className={`text-xs font-semibold tabular-nums shrink-0 ${paid ? "text-foreground/30" : "text-red/70"}`}>
                      −{formatCurrency(loan.monthly_payment)}<span className="text-foreground/30 font-normal">/mo</span>
                    </span>
                    <button
                      onClick={() => toggleLoanPaid(loan.id)}
                      className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
                        paid
                          ? "bg-green/10 hover:bg-green/20 text-green"
                          : "bg-card hover:bg-card-hover border border-border/40 text-foreground/40 hover:text-foreground"
                      }`}
                    >
                      {paid ? <CheckCircle2 className="w-3 h-3" /> : <Circle className="w-3 h-3" />}
                      {paid ? "Paid" : "Mark paid"}
                    </button>
                  </div>
                );
              })}
              <div className="flex items-center justify-between px-4 py-2 border-t border-border/20 mt-2">
                <span className="text-xs text-foreground/40">{paidLoanIds.size} of {loans.length} paid this month</span>
                <span className="text-xs font-semibold text-accent">{formatCurrency(totalLoanPayments)}<span className="text-foreground/30 font-normal"> /mo total</span></span>
              </div>
            </div>
          )}
        </Accordion>

        {/* ── Big Plans ── */}
        <Accordion
          title="Big Plans"
          icon={<div className="p-2.5 bg-purple-500/15 rounded-xl"><MapPin className="w-4 h-4 text-purple-400" /></div>}
          gradient="from-purple-500/10 to-purple-500/5"
        >
          {(config.scenarioEvents ?? []).length === 0 && !addingScenario && (
            <p className="text-xs text-foreground/40 py-2">No big plans yet. Add a future trip, wedding, purchase…</p>
          )}

          {/* Scenario list */}
          <div className="space-y-2">
            {(config.scenarioEvents ?? []).map(s => {
              const total = s.items.reduce((sum, it) => sum + it.amount, 0);
              const isExpanded = expandedScenarioId === s.id;
              const draft = newItemDrafts[s.id] ?? { label: "", amount: "" };
              return (
                <div key={s.id} className="rounded-xl border border-border/40 bg-card overflow-hidden">
                  {/* Header row */}
                  <div className="flex items-center gap-3 px-4 py-3 group">
                    <span className="text-lg shrink-0">{s.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-foreground truncate">{s.label}</div>
                      <div className="text-[10px] text-foreground/40">{MONTHS_FULL[s.month - 1]} {s.year} · {s.items.length} item{s.items.length !== 1 ? "s" : ""}</div>
                    </div>
                    <span className="text-sm font-bold text-red/70 tabular-nums shrink-0">{total > 0 ? `−${formatCurrency(total)}` : "—"}</span>
                    <button onClick={() => setExpandedScenarioId(isExpanded ? null : s.id)}
                      className="p-1 rounded-lg hover:bg-background/60 text-foreground/40 hover:text-foreground transition-colors">
                      <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                    </button>
                    <button onClick={() => removeScenario(s.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded-lg text-foreground/30 hover:text-red transition-all">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Expanded items */}
                  {isExpanded && (
                    <div className="border-t border-border/20 bg-background/30 px-4 py-3 space-y-2">
                      {s.items.length === 0 && (
                        <p className="text-xs text-foreground/30 pb-1">No items yet. Add line items below.</p>
                      )}
                      {s.items.map(it => (
                        <div key={it.id} className="flex items-center gap-3 text-xs">
                          <div className="w-1.5 h-1.5 rounded-full bg-purple-400/60 shrink-0" />
                          <span className="flex-1 text-foreground/80 font-medium truncate">{it.label}</span>
                          <span className="tabular-nums text-red/70 font-semibold">−{formatCurrency(it.amount)}</span>
                          <button onClick={() => removeScenarioItem(s.id, it.id)}
                            className="text-foreground/20 hover:text-red transition-colors shrink-0">
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                      {/* Add item form */}
                      <div className="flex items-center gap-2 pt-1">
                        <input
                          value={draft.label}
                          onChange={e => setNewItemDrafts(prev => ({ ...prev, [s.id]: { ...draft, label: e.target.value } }))}
                          onKeyDown={e => e.key === "Enter" && addScenarioItem(s.id)}
                          placeholder="Item name"
                          className="flex-1 bg-card border border-border/50 rounded-lg px-2.5 py-1.5 text-xs text-foreground placeholder-foreground/25 min-w-0"
                        />
                        <input
                          type="number"
                          value={draft.amount}
                          onChange={e => setNewItemDrafts(prev => ({ ...prev, [s.id]: { ...draft, amount: e.target.value } }))}
                          onKeyDown={e => e.key === "Enter" && addScenarioItem(s.id)}
                          placeholder="$"
                          className="w-20 bg-card border border-border/50 rounded-lg px-2.5 py-1.5 text-xs text-foreground placeholder-foreground/25"
                        />
                        <button onClick={() => addScenarioItem(s.id)}
                          className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 bg-accent hover:bg-accent/90 text-white text-xs rounded-lg font-semibold transition-colors shadow-sm">
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                      {s.items.length > 0 && (
                        <div className="flex justify-end border-t border-border/15 pt-2 mt-1">
                          <span className="text-xs font-bold text-red/70 tabular-nums">−{formatCurrency(total)} total</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* New scenario form */}
          {addingScenario ? (
            <div className="bg-background/60 border border-border/30 rounded-xl p-4 space-y-3">
              <div className="flex flex-wrap gap-3">
                <div className="flex flex-col gap-1 flex-1 min-w-36">
                  <label className="text-[10px] text-foreground/40 uppercase tracking-wide">Name</label>
                  <input autoFocus value={newScenario.label}
                    onChange={e => setNewScenario(f => ({ ...f, label: e.target.value }))}
                    onKeyDown={e => e.key === "Enter" && addScenario()}
                    placeholder="e.g. Europe trip"
                    className="bg-card border border-border/50 rounded-lg px-2.5 py-1.5 text-xs text-foreground placeholder-foreground/25" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-foreground/40 uppercase tracking-wide">Month</label>
                  <select value={newScenario.month} onChange={e => setNewScenario(f => ({ ...f, month: parseInt(e.target.value) }))}
                    className="bg-card border border-border/50 rounded-lg px-2.5 py-1.5 text-xs text-foreground">
                    {MONTHS_FULL.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-foreground/40 uppercase tracking-wide">Year</label>
                  <select value={newScenario.year} onChange={e => setNewScenario(f => ({ ...f, year: parseInt(e.target.value) }))}
                    className="bg-card border border-border/50 rounded-lg px-2.5 py-1.5 text-xs text-foreground">
                    {[CUR_YEAR, CUR_YEAR + 1, CUR_YEAR + 2, CUR_YEAR + 3].map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-foreground/40 uppercase tracking-wide">Icon</label>
                <div className="flex flex-wrap gap-1.5">
                  {SCENARIO_EMOJIS.map(em => (
                    <button key={em} onClick={() => setNewScenario(f => ({ ...f, emoji: em }))}
                      className={`text-lg w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                        newScenario.emoji === em ? "bg-accent/20 ring-1 ring-accent/50" : "bg-card hover:bg-card-hover border border-border/30"
                      }`}>{em}</button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={addScenario} className="flex items-center gap-1.5 px-4 py-1.5 bg-accent hover:bg-accent/90 text-white text-xs rounded-lg font-semibold transition-colors shadow-sm">
                  <Check className="w-3 h-3" /> Create plan
                </button>
                <button onClick={() => setAddingScenario(false)}
                  className="px-3 py-1.5 bg-card hover:bg-card-hover text-foreground/60 hover:text-foreground text-xs rounded-lg border border-border/40 hover:border-border/60 transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setAddingScenario(true)}
              className="flex items-center gap-1 text-xs text-accent-light hover:text-accent transition-colors w-fit">
              <Plus className="w-3 h-3" /> Add plan
            </button>
          )}
        </Accordion>
        </div>
      </div>
    </div>
  );
}
