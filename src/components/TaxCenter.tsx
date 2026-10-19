"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Calculator, Check, ChevronDown, CircleCheck, Clock3, Loader2, Plus, Trash2, TrendingUp, WalletCards } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getPlannerConfig, upsertPlannerConfig } from "@/lib/supabase/queries";
import { formatCurrency } from "@/lib/format";
import { computeAnnualTax, type FilingStatus } from "@/lib/tax";

interface TaxYearRecord {
  actualGrossIncome?: string;
  actualWithholding?: string;
  expectedRemainingGross?: string;
  expectedRemainingWithholding?: string;
  estimatedPayments?: string;
  taxCredits?: string;
  deductions?: string;
  dividends?: string;
  investmentProceeds?: string;
  investmentCostBasis?: string;
  realizedCapitalGain?: string;
  expectedRefundDate?: string;
  estimatedRefundAmount?: string;
  refundReceived?: boolean;
  refundReceivedDate?: string;
  refundEventId?: string;
  otherIncome?: TaxIncomeItem[];
}

interface TaxIncomeItem {
  id: string;
  label: string;
  type: "interest" | "dividend" | "freelance" | "rental" | "capital_gain" | "other";
  amount: string;
  account?: string;
  notes?: string;
}

interface TaxConfig {
  taxYearTracking?: Record<string, TaxYearRecord>;
  events?: Array<{ id: string; year: number; month: number; label: string; amount: number; type: string }>;
  salaryPeriods?: Array<{
    startYear: number;
    startMonth: number;
    monthlySalary: number;
    withholdingRate?: number;
    payFrequency?: "monthly" | "semimonthly" | "biweekly" | "weekly";
    payDay1?: number;
    payDay2?: number;
    paidPaydays?: Record<string, number[]>;
    unpaidPaydays?: Record<string, number[]>;
  }>;
}

type TaxInputKey = Exclude<keyof TaxYearRecord, "refundReceived" | "otherIncome">;

const CURRENT_YEAR = new Date().getFullYear();
const CURRENT_MONTH = new Date().getMonth() + 1;
const YEAR_OPTIONS = Array.from({ length: 5 }, (_, index) => CURRENT_YEAR - 1 + index);

function amount(value: string | undefined): number {
  return Math.max(0, parseFloat(value ?? "") || 0);
}

function salaryForMonth(periods: TaxConfig["salaryPeriods"], year: number, month: number): number {
  const applicable = (periods ?? [])
    .filter(period => period.startYear < year || (period.startYear === year && period.startMonth <= month))
    .sort((a, b) => (a.startYear * 12 + a.startMonth) - (b.startYear * 12 + b.startMonth));
  return applicable[applicable.length - 1]?.monthlySalary ?? 0;
}

function salaryPeriodForMonth(periods: TaxConfig["salaryPeriods"], year: number, month: number) {
  const applicable = (periods ?? [])
    .filter(period => period.startYear < year || (period.startYear === year && period.startMonth <= month))
    .sort((a, b) => (a.startYear * 12 + a.startMonth) - (b.startYear * 12 + b.startMonth));
  return applicable[applicable.length - 1];
}

function paycheckDays(period: NonNullable<TaxConfig["salaryPeriods"]>[number]): number[] {
  if (period.payFrequency === "semimonthly") return [period.payDay1 ?? 15, period.payDay2 ?? 30];
  return [period.payDay1 ?? 15];
}

function paycheckPaid(period: NonNullable<TaxConfig["salaryPeriods"]>[number], year: number, month: number, day: number): boolean {
  const key = `${year}-${String(month).padStart(2, "0")}`;
  const paid = period.paidPaydays?.[key] ?? [];
  const unpaid = period.unpaidPaydays?.[key] ?? [];
  return paid.includes(day) && !unpaid.includes(day);
}

function salaryReceivedToDate(periods: TaxConfig["salaryPeriods"], year: number): number {
  if (year > CURRENT_YEAR) return 0;
  let total = 0;
  const lastMonth = year < CURRENT_YEAR ? 12 : CURRENT_MONTH;
  for (let month = 1; month <= lastMonth; month++) {
    const salary = salaryForMonth(periods, year, month);
    if (month < lastMonth || year < CURRENT_YEAR) {
      total += salary;
      continue;
    }
    const period = salaryPeriodForMonth(periods, year, month);
    const days = period ? paycheckDays(period) : [];
    const paidCount = period ? days.filter(day => paycheckPaid(period, year, month, day)).length : 0;
    total += days.length > 0 ? salary * paidCount / days.length : 0;
  }
  return total;
}

function expectedSalaryAfterNow(periods: TaxConfig["salaryPeriods"], year: number): number {
  let total = 0;
  if (year < CURRENT_YEAR) return 0;
  if (year === CURRENT_YEAR) {
    const salary = salaryForMonth(periods, year, CURRENT_MONTH);
    const period = salaryPeriodForMonth(periods, year, CURRENT_MONTH);
    const days = period ? paycheckDays(period) : [];
    const unpaidCount = period ? days.filter(day => !paycheckPaid(period, year, CURRENT_MONTH, day)).length : 0;
    total += days.length > 0 ? salary * unpaidCount / days.length : 0;
    for (let month = CURRENT_MONTH + 1; month <= 12; month++) total += salaryForMonth(periods, year, month);
    return total;
  }
  for (let month = 1; month <= 12; month++) total += salaryForMonth(periods, year, month);
  return total;
}

function expectedWithholdingAfterNow(periods: TaxConfig["salaryPeriods"], year: number): number {
  if (year < CURRENT_YEAR) return 0;
  let total = 0;
  const firstMonth = year === CURRENT_YEAR ? CURRENT_MONTH : 1;
  for (let month = firstMonth; month <= 12; month++) {
    const period = salaryPeriodForMonth(periods, year, month);
    const salary = salaryForMonth(periods, year, month);
    const days = period ? paycheckDays(period) : [];
    const remainingSalary = year === CURRENT_YEAR && month === CURRENT_MONTH
      ? (days.length > 0 ? salary * days.filter(day => !paycheckPaid(period!, year, month, day)).length / days.length : 0)
      : salary;
    const rate = Math.max(0, Math.min(100, period?.withholdingRate ?? 0)) / 100;
    total += remainingSalary * rate;
  }
  return total;
}

export default function TaxCenter() {
  const [year, setYear] = useState(CURRENT_YEAR);
  const [record, setRecord] = useState<TaxYearRecord>({});
  const [salaryPeriods, setSalaryPeriods] = useState<TaxConfig["salaryPeriods"]>([]);
  const [filingStatus, setFilingStatus] = useState<FilingStatus>("single");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [incomeOpen, setIncomeOpen] = useState(true);
  const [investmentsOpen, setInvestmentsOpen] = useState(false);
  const [otherIncomeOpen, setOtherIncomeOpen] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const row = await getPlannerConfig(createClient());
        if (!cancelled) {
          const config = (row?.config ?? {}) as TaxConfig;
          setRecord(config.taxYearTracking?.[String(year)] ?? {});
          setSalaryPeriods(config.salaryPeriods ?? []);
          if (row?.tax_filing_status) setFilingStatus(row.tax_filing_status as FilingStatus);
        }
      } catch {
        if (!cancelled) setMessage("Could not load saved tax information.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [year]);

  const update = (field: TaxInputKey, value: string) => {
    setRecord(previous => ({ ...previous, [field]: value }));
    setMessage("");
  };

  const updateIncomeItem = (id: string, field: keyof TaxIncomeItem, value: string) => {
    setRecord(previous => ({
      ...previous,
      otherIncome: (previous.otherIncome ?? []).map(item => item.id === id ? { ...item, [field]: value } : item),
    }));
    setMessage("");
  };

  const addIncomeItem = () => {
    const id = `income-${Date.now()}`;
    setRecord(previous => ({
      ...previous,
      otherIncome: [...(previous.otherIncome ?? []), { id, label: "", type: "interest", amount: "", account: "" }],
    }));
    setOtherIncomeOpen(true);
  };

  const removeIncomeItem = (id: string) => {
    setRecord(previous => ({ ...previous, otherIncome: (previous.otherIncome ?? []).filter(item => item.id !== id) }));
  };

  async function saveRecord(nextRecord: TaxYearRecord, notify: boolean) {
    setSaving(true);
    if (notify) setMessage("");
    try {
      const supabase = createClient();
      const row = await getPlannerConfig(supabase);
      const config = (row?.config ?? {}) as TaxConfig;
      await upsertPlannerConfig(supabase, {
        config: {
          ...config,
          taxYearTracking: {
            ...(config.taxYearTracking ?? {}),
            [String(year)]: {
              ...nextRecord,
              estimatedRefundAmount: estimatedRefund !== null ? String(Math.max(0, estimatedRefund)) : undefined,
            },
          },
        },
      });
      if (notify) setMessage(`${year} tax details saved.`);
    } catch {
      if (notify) setMessage("Could not save tax details. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const save = () => saveRecord(record, true);

  const expectedGrossFallback = expectedSalaryAfterNow(salaryPeriods, year);
  const actualGrossFallback = salaryReceivedToDate(salaryPeriods, year);
  const projectedGross = useMemo(() => {
    const actualGross = amount(record.actualGrossIncome) > 0 ? amount(record.actualGrossIncome) : actualGrossFallback;
    const expectedGross = amount(record.expectedRemainingGross) > 0 ? amount(record.expectedRemainingGross) : expectedGrossFallback;
    const otherIncome = (record.otherIncome ?? []).reduce((sum, item) => sum + amount(item.amount), 0);
    return { wages: actualGross + expectedGross, otherIncome, total: actualGross + expectedGross + otherIncome };
  }, [actualGrossFallback, expectedGrossFallback, record]);
  const projectedTax = useMemo(
    () => computeAnnualTax(projectedGross.total, filingStatus, year, projectedGross.wages),
    [filingStatus, projectedGross, year],
  );
  const hasExpectedWithholdingOverride = (record.expectedRemainingWithholding ?? "").trim() !== "";
  const expectedWithholdingFallback = expectedWithholdingAfterNow(salaryPeriods, year);

  const totals = useMemo(() => {
    const actualGross = amount(record.actualGrossIncome) > 0
      ? amount(record.actualGrossIncome)
      : salaryReceivedToDate(salaryPeriods, year);
    const expectedWithholding = hasExpectedWithholdingOverride
      ? amount(record.expectedRemainingWithholding)
      : expectedWithholdingFallback;
    const withholding = amount(record.actualWithholding) + expectedWithholding;
    const investments = amount(record.investmentProceeds) - amount(record.investmentCostBasis);
    const otherIncome = (record.otherIncome ?? []).reduce((sum, item) => sum + amount(item.amount), 0);
    const expectedFromSalary = amount(record.expectedRemainingGross) > 0
      ? amount(record.expectedRemainingGross)
      : expectedSalaryAfterNow(salaryPeriods, year);
    return { income: actualGross + expectedFromSalary + otherIncome, withholding, investments, otherIncome };
  }, [expectedWithholdingFallback, hasExpectedWithholdingOverride, record, salaryPeriods, year]);

  const estimatedRefund = useMemo(() => {
    if (!projectedTax) return null;
    const expectedWithholding = hasExpectedWithholdingOverride
      ? amount(record.expectedRemainingWithholding)
      : expectedWithholdingFallback;
    const paid = amount(record.actualWithholding) + expectedWithholding
      + amount(record.estimatedPayments) + amount(record.taxCredits);
    return paid - projectedTax.total;
  }, [expectedWithholdingFallback, hasExpectedWithholdingOverride, projectedTax, record]);

  const incomeComplete = amount(record.actualGrossIncome) > 0 && amount(record.actualWithholding) >= 0;
  const investmentComplete = amount(record.investmentProceeds) > 0 || amount(record.dividends) > 0 || amount(record.realizedCapitalGain) !== 0;

  if (loading) {
    return <div className="flex items-center justify-center rounded-2xl border border-border/30 bg-card/30 p-12 text-foreground/50"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading tax details…</div>;
  }

  const field = (key: TaxInputKey, label: string, placeholder: string) => (
    <label className="text-[10px] text-foreground/50">
      {label}
      <input
        type="number"
        min="0"
        step="0.01"
        value={record[key] ?? ""}
        onChange={event => update(key, event.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-border/50 bg-background px-2.5 py-2 text-xs text-foreground placeholder-foreground/25"
      />
    </label>
  );

  const saveRefundStatus = async (received: boolean) => {
    setSaving(true);
    setMessage("");
    try {
      const supabase = createClient();
      const row = await getPlannerConfig(supabase);
      const config = (row?.config ?? {}) as TaxConfig;
      const current = {
        ...(config.taxYearTracking?.[String(year)] ?? {}),
        ...record,
      };
      const refundAmount = Math.max(0, estimatedRefund ?? 0);
      const eventId = current.refundEventId ?? `tax-refund-${year}`;
      const receivedDate = received
        ? (current.refundReceivedDate ?? new Date().toISOString().slice(0, 10))
        : undefined;
      const nextRecord = {
        ...current,
        estimatedRefundAmount: estimatedRefund !== null ? String(Math.max(0, estimatedRefund)) : undefined,
        refundReceived: received,
        refundReceivedDate: receivedDate,
        refundEventId: refundAmount > 0 ? eventId : undefined,
      };
      const events = (config.events ?? []).filter(event => event.id !== eventId);
      await upsertPlannerConfig(supabase, {
        config: {
          ...config,
          events,
          taxYearTracking: {
            ...(config.taxYearTracking ?? {}),
            [String(year)]: nextRecord,
          },
        },
      });
      setRecord(nextRecord);
      setMessage(received ? "Refund marked received and added to Planner income." : "Refund marked as not received.");
    } catch {
      setMessage("Could not update the refund status. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-accent-light">Tax Center</p>
          <h2 className="mt-1 text-2xl font-bold text-foreground">Tax details and year tracking</h2>
          <p className="mt-1 max-w-2xl text-sm text-foreground/50">A guided snapshot of your pay stubs, investments, and refund progress for each tax year.</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={year} onChange={event => setYear(Number(event.target.value))} className="rounded-xl border border-border/50 bg-card px-3 py-2 text-sm text-foreground">
            {YEAR_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
          </select>
          <button onClick={save} disabled={saving} className="flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-sm font-semibold text-white shadow-lg shadow-accent/10 disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save changes
          </button>
        </div>
      </div>

      {message && <p className="rounded-lg border border-accent/20 bg-accent/5 px-3 py-2 text-xs text-accent-light">{message}</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Income tracked", value: totals.income, color: "text-green", icon: WalletCards, note: incomeComplete ? "Pay-stub totals added" : "Add your pay stubs" },
          { label: "Withholding tracked", value: totals.withholding, color: "text-rose-400", icon: Calculator, note: "Actual + expected" },
          { label: "Investment gain/loss", value: totals.investments, color: totals.investments >= 0 ? "text-green" : "text-red", icon: TrendingUp, note: investmentComplete ? "Brokerage activity added" : "Optional" },
          { label: estimatedRefund !== null && estimatedRefund >= 0 ? "Estimated refund" : "Estimated amount due", value: Math.abs(estimatedRefund ?? 0), color: estimatedRefund !== null && estimatedRefund >= 0 ? "text-accent-light" : "text-orange-400", icon: CircleCheck, note: record.refundReceived ? "Received" : "Based on current entries" },
        ].map(({ label, value, color, icon: Icon, note }) => (
          <div key={label} className="rounded-2xl border border-border/40 bg-card p-4 transition-colors hover:border-accent/30">
            <div className="flex items-center justify-between gap-2"><p className="text-[10px] uppercase tracking-wider text-foreground/40">{label}</p><Icon className={`h-4 w-4 ${color}`} /></div>
            <p className={`mt-2 text-xl font-bold tabular-nums ${color}`}>{formatCurrency(Number(value))}</p>
            <p className="mt-1 text-[10px] text-foreground/35">{note}</p>
          </div>
        ))}
      </div>

      <section className="rounded-2xl border border-border/40 bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-accent-light">Projected tax breakdown</p>
            <h3 className="mt-1 font-semibold text-foreground">Where the annual estimate comes from</h3>
            <p className="mt-1 text-[10px] text-foreground/40">
              Washington has no state individual income tax. Payroll taxes apply to projected wages, not interest or other non-wage income.
            </p>
          </div>
          {projectedTax && <div className="text-right"><p className="text-[10px] uppercase tracking-wider text-foreground/40">Projected total</p><p className="text-lg font-bold tabular-nums text-foreground">{formatCurrency(projectedTax.total)}</p><p className="text-[10px] text-foreground/40">{(projectedTax.effectiveRate * 100).toFixed(1)}% effective rate</p></div>}
        </div>
        {projectedTax ? (
          <div className="mt-4 space-y-3">
            {[
              { label: "Federal income tax", value: projectedTax.federal, color: "bg-accent" },
              { label: "Social Security", value: projectedTax.ss, color: "bg-cyan-400" },
              { label: "Medicare", value: projectedTax.medicare, color: "bg-violet-400" },
              { label: "WA Cares Fund", value: projectedTax.waCares, color: "bg-amber-400" },
            ].map(item => (
              <div key={item.label}>
                <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                  <span className="flex items-center gap-2 text-foreground/65"><span className={`h-2 w-2 rounded-full ${item.color}`} />{item.label}</span>
                  <span className="font-semibold tabular-nums text-foreground">{formatCurrency(item.value)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-background">
                  <div className={`h-full rounded-full ${item.color}`} style={{ width: `${projectedTax.total > 0 ? Math.min(100, (item.value / projectedTax.total) * 100) : 0}%` }} />
                </div>
              </div>
            ))}
            <p className="border-t border-border/20 pt-3 text-[10px] leading-relaxed text-foreground/35">
              Federal tax uses the selected filing status and standard deduction. Social Security, Medicare, and WA Cares are estimated from wages; actual pay-stub withholding remains the best source for your refund estimate.
            </p>
          </div>
        ) : (
          <p className="mt-4 rounded-xl border border-dashed border-border/30 px-3 py-4 text-xs text-foreground/40">Add projected income to see the tax breakdown.</p>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-border/40 bg-card">
        <button type="button" onClick={() => setIncomeOpen(open => !open)} className="flex w-full items-center justify-between gap-3 p-4 text-left sm:p-5">
          <span className="flex items-center gap-3"><span className="rounded-xl bg-green/10 p-2 text-green"><WalletCards className="h-4 w-4" /></span><span><span className="block font-semibold text-foreground">Income snapshot</span><span className="mt-0.5 block text-[10px] text-foreground/40">Use your latest pay stubs, then add what you expect for the rest of the year.</span></span></span>
          <ChevronDown className={`h-4 w-4 text-foreground/40 transition-transform ${incomeOpen ? "rotate-180" : ""}`} />
        </button>
        {incomeOpen && <div className="border-t border-border/20 p-4 pt-4 sm:p-5 sm:pt-4"><div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {field("actualGrossIncome", "Actual gross income to date", "Pay stubs")}
          <label className="text-[10px] text-foreground/50">
            Expected remaining gross
            <input type="number" min="0" step="0.01" value={record.expectedRemainingGross ?? ""}
              onChange={event => update("expectedRemainingGross", event.target.value)}
              placeholder={expectedGrossFallback > 0 ? formatCurrency(expectedGrossFallback) : "Future pay"}
              className="mt-1 w-full rounded-lg border border-border/50 bg-background px-2.5 py-2 text-xs text-foreground placeholder-foreground/25" />
            <span className="mt-1 block text-[9px] text-foreground/30">
              {record.expectedRemainingGross ? "Manual override" : expectedGrossFallback > 0 ? "From Income Schedule" : "Add a salary schedule"}
            </span>
          </label>
          {field("actualWithholding", "Tax withheld to date", "Pay stubs")}
          <label className="text-[10px] text-foreground/50">
            Expected remaining withholding
            <input type="number" min="0" step="0.01" value={record.expectedRemainingWithholding ?? ""}
              onChange={event => update("expectedRemainingWithholding", event.target.value)}
              placeholder={expectedWithholdingFallback > 0 ? formatCurrency(expectedWithholdingFallback) : "Future pay"}
              className="mt-1 w-full rounded-lg border border-border/50 bg-background px-2.5 py-2 text-xs text-foreground placeholder-foreground/25" />
            <span className="mt-1 block text-[9px] text-foreground/30">
              {record.expectedRemainingWithholding ? "Manual override" : expectedWithholdingFallback > 0 ? "From salary schedule × withholding %" : "Add a salary schedule"}
            </span>
          </label>
        </div></div>}
      </section>

      <section className="overflow-hidden rounded-2xl border border-border/40 bg-card">
        <div className="flex items-center justify-between gap-3 p-4 sm:p-5">
          <button type="button" onClick={() => setOtherIncomeOpen(open => !open)} className="flex min-w-0 items-center gap-3 text-left">
            <span className="rounded-xl bg-cyan-400/10 p-2 text-cyan-300"><Plus className="h-4 w-4" /></span>
            <span><span className="block font-semibold text-foreground">Other income</span><span className="mt-0.5 block text-[10px] text-foreground/40">Interest, freelance, rental, dividends, or anything outside your paycheck.</span></span>
            <ChevronDown className={`h-4 w-4 shrink-0 text-foreground/40 transition-transform ${otherIncomeOpen ? "rotate-180" : ""}`} />
          </button>
          <button type="button" onClick={addIncomeItem} className="flex shrink-0 items-center gap-1 rounded-lg border border-accent/30 bg-accent/10 px-2.5 py-1.5 text-xs font-semibold text-accent-light hover:bg-accent/20">
            <Plus className="h-3 w-3" /> Add income
          </button>
        </div>
        {otherIncomeOpen && <div className="border-t border-border/20 p-4 pt-3 sm:p-5 sm:pt-4">
          {(record.otherIncome ?? []).length === 0 ? (
            <button type="button" onClick={addIncomeItem} className="flex w-full items-center justify-center rounded-xl border border-dashed border-border/40 px-4 py-5 text-xs text-foreground/40 hover:border-accent/40 hover:text-accent-light">
              Add interest from a savings account, dividends, freelance income, or another source
            </button>
          ) : (
            <div className="space-y-2">
              {(record.otherIncome ?? []).map(item => (
                <div key={item.id} className="grid grid-cols-1 gap-2 rounded-xl border border-border/30 bg-background/30 p-3 sm:grid-cols-[1.2fr_1fr_1.2fr_1fr_auto] sm:items-end">
                  <label className="text-[10px] text-foreground/50">Income name
                    <input value={item.label} onChange={event => updateIncomeItem(item.id, "label", event.target.value)} placeholder="e.g. Savings interest" className="mt-1 w-full rounded-lg border border-border/50 bg-background px-2.5 py-2 text-xs text-foreground placeholder-foreground/25" />
                  </label>
                  <label className="text-[10px] text-foreground/50">Type
                    <select value={item.type} onChange={event => updateIncomeItem(item.id, "type", event.target.value)} className="mt-1 w-full rounded-lg border border-border/50 bg-background px-2.5 py-2 text-xs text-foreground">
                      <option value="interest">Interest</option><option value="dividend">Dividend</option><option value="freelance">Freelance</option><option value="rental">Rental</option><option value="capital_gain">Capital gain</option><option value="other">Other</option>
                    </select>
                  </label>
                  <label className="text-[10px] text-foreground/50">Account or source
                    <input value={item.account ?? ""} onChange={event => updateIncomeItem(item.id, "account", event.target.value)} placeholder="e.g. Ally savings" className="mt-1 w-full rounded-lg border border-border/50 bg-background px-2.5 py-2 text-xs text-foreground placeholder-foreground/25" />
                  </label>
                  <label className="text-[10px] text-foreground/50">Annual amount
                    <input type="number" min="0" step="0.01" value={item.amount} onChange={event => updateIncomeItem(item.id, "amount", event.target.value)} placeholder="$0.00" className="mt-1 w-full rounded-lg border border-border/50 bg-background px-2.5 py-2 text-xs text-foreground placeholder-foreground/25" />
                  </label>
                  <button type="button" onClick={() => removeIncomeItem(item.id)} aria-label={`Remove ${item.label || "income item"}`} className="justify-self-end rounded-lg p-2 text-foreground/30 hover:bg-red/10 hover:text-red"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
              <button type="button" onClick={addIncomeItem} className="text-xs font-semibold text-accent-light hover:text-accent">+ Add another income source</button>
            </div>
          )}
        </div>}
      </section>

      <section className="rounded-2xl border border-border/40 bg-card p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2"><span className="rounded-xl bg-accent/10 p-2 text-accent-light"><Clock3 className="h-4 w-4" /></span><h3 className="font-semibold text-foreground">Refund timeline</h3></div>
            <p className="mt-0.5 text-[10px] text-foreground/40">Track when you expect the refund and when it actually reaches your account.</p>
          </div>
          {estimatedRefund !== null && (
            <span className={`text-sm font-bold tabular-nums ${estimatedRefund >= 0 ? "text-green" : "text-red"}`}>
              {estimatedRefund >= 0 ? "Estimated refund " : "Estimated amount due "}
              {formatCurrency(Math.abs(estimatedRefund))}
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-violet-400/20 bg-violet-400/5 p-3">
            <div className="mb-2 flex items-center gap-2"><span className="rounded-lg bg-violet-400/10 p-1.5 text-violet-300"><CalendarDays className="h-3.5 w-3.5" /></span><div><p className="text-xs font-semibold text-foreground/80">Expected arrival</p><p className="text-[10px] text-foreground/35">This date appears on the Planner calendar.</p></div></div>
            <input aria-label="Expected refund date" type="date" value={record.expectedRefundDate ?? ""} onChange={event => update("expectedRefundDate", event.target.value)}
              className="h-10 w-full rounded-lg border border-violet-400/20 bg-background px-3 text-sm font-medium text-foreground [color-scheme:dark]" />
          </div>
          <div className={`rounded-xl border p-3 ${record.refundReceived ? "border-green/25 bg-green/5" : "border-border/30 bg-background/20"}`}>
            <div className="mb-2 flex items-center gap-2"><span className={`rounded-lg p-1.5 ${record.refundReceived ? "bg-green/10 text-green" : "bg-border/30 text-foreground/30"}`}><CircleCheck className="h-3.5 w-3.5" /></span><div><p className="text-xs font-semibold text-foreground/80">Actual arrival</p><p className="text-[10px] text-foreground/35">{record.refundReceived ? "The refund is recorded as received." : "Mark received to enter this date."}</p></div></div>
            <input aria-label="Received date" type="date" value={record.refundReceivedDate ?? ""} disabled={!record.refundReceived}
              onChange={event => update("refundReceivedDate", event.target.value)}
              className="h-10 w-full rounded-lg border border-border/30 bg-background px-3 text-sm font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-35 [color-scheme:dark]" />
          </div>
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <button onClick={() => saveRefundStatus(!record.refundReceived)} disabled={saving || estimatedRefund === null || estimatedRefund <= 0}
            className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              record.refundReceived ? "border-green/30 bg-green/10 text-green hover:bg-green/20" : "border-accent/30 bg-accent/10 text-accent-light hover:bg-accent/20"
            }`}>
            <Check className="h-4 w-4" />
            {record.refundReceived ? "Mark as not received" : "Mark refund received"}
          </button>
          <span className="text-[10px] text-foreground/35">{record.refundReceived ? "You can undo this if the status was entered by mistake." : "The button becomes available when a positive refund estimate exists."}</span>
        </div>
        <p className="mt-3 text-[10px] text-foreground/35">
          When marked received, the expected refund is removed from future Planner projections because it should already be reflected in your account balance. Unmarking it restores the expected projection.
        </p>
      </section>

      <section className="overflow-hidden rounded-2xl border border-border/40 bg-card">
        <button type="button" onClick={() => setInvestmentsOpen(open => !open)} className="flex w-full items-center justify-between gap-3 p-4 text-left sm:p-5">
          <span className="flex items-center gap-3"><span className="rounded-xl bg-violet-500/10 p-2 text-violet-300"><TrendingUp className="h-4 w-4" /></span><span><span className="block font-semibold text-foreground">Investments and deductions</span><span className="mt-0.5 block text-[10px] text-foreground/40">Add brokerage totals from your 1099 forms when they become available.</span></span></span>
          <ChevronDown className={`h-4 w-4 text-foreground/40 transition-transform ${investmentsOpen ? "rotate-180" : ""}`} />
        </button>
        {investmentsOpen && <div className="border-t border-border/20 p-4 pt-4 sm:p-5 sm:pt-4"><div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {field("investmentProceeds", "Stock/crypto sale proceeds", "Total sales")}
          {field("investmentCostBasis", "Stock/crypto cost basis", "What you paid")}
          {field("realizedCapitalGain", "Realized capital gain/loss", "Optional override")}
          {field("dividends", "Dividends and distributions", "Brokerage forms")}
          {field("deductions", "Deductions", "Itemized or other")}
          {field("taxCredits", "Tax credits", "Credits")}
          {field("estimatedPayments", "Estimated tax payments", "Payments")}
        </div><p className="mt-3 text-[10px] leading-relaxed text-foreground/35">Use your brokerage 1099 forms for proceeds, cost basis, realized gains, and dividends. These entries are tracking data and do not replace tax filing advice.</p></div>}
      </section>
    </div>
  );
}
