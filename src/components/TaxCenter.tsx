"use client";

import { useEffect, useMemo, useState } from "react";
import { Calculator, Check, ChevronDown, CircleCheck, Clock3, Loader2, Plus, Trash2, TrendingUp, WalletCards } from "lucide-react";
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
  salaryPeriods?: Array<{ startYear: number; startMonth: number; monthlySalary: number; withholdingRate?: number }>;
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

function expectedSalaryAfterNow(periods: TaxConfig["salaryPeriods"], year: number): number {
  const firstMonth = year === CURRENT_YEAR ? CURRENT_MONTH + 1 : 1;
  let total = 0;
  for (let month = firstMonth; month <= 12; month++) total += salaryForMonth(periods, year, month);
  return total;
}

function expectedWithholdingAfterNow(periods: TaxConfig["salaryPeriods"], year: number): number {
  const firstMonth = year === CURRENT_YEAR ? CURRENT_MONTH + 1 : 1;
  let total = 0;
  for (let month = firstMonth; month <= 12; month++) {
    const applicable = (periods ?? [])
      .filter(period => period.startYear < year || (period.startYear === year && period.startMonth <= month))
      .sort((a, b) => (a.startYear * 12 + a.startMonth) - (b.startYear * 12 + b.startMonth));
    const period = applicable[applicable.length - 1];
    total += period ? period.monthlySalary * Math.max(0, Math.min(100, period.withholdingRate ?? 0)) / 100 : 0;
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

  const save = async () => {
    setSaving(true);
    setMessage("");
    try {
      const supabase = createClient();
      const row = await getPlannerConfig(supabase);
      const config = (row?.config ?? {}) as TaxConfig;
      await upsertPlannerConfig(supabase, {
        config: {
          ...config,
          taxYearTracking: {
            ...(config.taxYearTracking ?? {}),
            [String(year)]: record,
          },
        },
      });
      setMessage(`${year} tax details saved.`);
    } catch {
      setMessage("Could not save tax details. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const totals = useMemo(() => {
    const expectedWithholding = amount(record.expectedRemainingWithholding) > 0
      ? amount(record.expectedRemainingWithholding)
      : expectedWithholdingAfterNow(salaryPeriods, year);
    const withholding = amount(record.actualWithholding) + expectedWithholding;
    const investments = amount(record.investmentProceeds) - amount(record.investmentCostBasis);
    const otherIncome = (record.otherIncome ?? []).reduce((sum, item) => sum + amount(item.amount), 0);
    const expectedFromSalary = amount(record.expectedRemainingGross) > 0
      ? amount(record.expectedRemainingGross)
      : expectedSalaryAfterNow(salaryPeriods, year);
    return { income: amount(record.actualGrossIncome) + expectedFromSalary + otherIncome, withholding, investments, otherIncome };
  }, [record, salaryPeriods, year]);

  const estimatedRefund = useMemo(() => {
    const expectedFromSalary = amount(record.expectedRemainingGross) > 0
      ? amount(record.expectedRemainingGross)
      : expectedSalaryAfterNow(salaryPeriods, year);
    const gross = amount(record.actualGrossIncome) + expectedFromSalary;
    const otherIncome = (record.otherIncome ?? []).reduce((sum, item) => sum + amount(item.amount), 0);
    if (gross + otherIncome <= 0) return null;
    const tax = computeAnnualTax(gross + otherIncome, filingStatus, year);
    if (!tax) return null;
    const expectedWithholding = amount(record.expectedRemainingWithholding) > 0
      ? amount(record.expectedRemainingWithholding)
      : expectedWithholdingAfterNow(salaryPeriods, year);
    const paid = amount(record.actualWithholding) + expectedWithholding
      + amount(record.estimatedPayments) + amount(record.taxCredits);
    return paid - tax.total;
  }, [filingStatus, record, salaryPeriods, year]);

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
        onBlur={save}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-border/50 bg-background px-2.5 py-2 text-xs text-foreground placeholder-foreground/25"
      />
    </label>
  );

  const expectedGrossFallback = expectedSalaryAfterNow(salaryPeriods, year);
  const expectedWithholdingFallback = expectedWithholdingAfterNow(salaryPeriods, year);

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
        refundReceived: received,
        refundReceivedDate: receivedDate,
        refundEventId: refundAmount > 0 ? eventId : undefined,
      };
      const events = (config.events ?? []).filter(event => event.id !== eventId);
      if (received && refundAmount > 0 && receivedDate) {
        const date = new Date(`${receivedDate}T12:00:00`);
        events.push({
          id: eventId,
          year: date.getFullYear(),
          month: date.getMonth() + 1,
          label: `${year} tax refund`,
          amount: refundAmount,
          type: "income",
        });
      }
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
              onBlur={save}
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
              onBlur={save}
              placeholder={expectedWithholdingFallback > 0 ? formatCurrency(expectedWithholdingFallback) : "Future pay"}
              className="mt-1 w-full rounded-lg border border-border/50 bg-background px-2.5 py-2 text-xs text-foreground placeholder-foreground/25" />
            <span className="mt-1 block text-[9px] text-foreground/30">
              {record.expectedRemainingWithholding ? "Manual override" : expectedWithholdingFallback > 0 ? "From salary × actual withholding %" : "Add withholding %"}
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="text-[10px] text-foreground/50">
            Expected refund date
            <input type="date" value={record.expectedRefundDate ?? ""} onChange={event => update("expectedRefundDate", event.target.value)}
              onBlur={save}
              className="mt-1 w-full rounded-lg border border-border/50 bg-background px-2.5 py-2 text-xs text-foreground" />
          </label>
          <label className="text-[10px] text-foreground/50">
            Received date
            <input type="date" value={record.refundReceivedDate ?? ""} disabled={!record.refundReceived}
              onChange={event => update("refundReceivedDate", event.target.value)}
              onBlur={save}
              className="mt-1 w-full rounded-lg border border-border/50 bg-background px-2.5 py-2 text-xs text-foreground disabled:opacity-40" />
          </label>
          <div className="flex items-end">
            <button onClick={() => saveRefundStatus(!record.refundReceived)} disabled={saving || estimatedRefund === null || estimatedRefund <= 0}
              className={`flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                record.refundReceived ? "border-green/30 bg-green/10 text-green hover:bg-green/20" : "border-accent/30 bg-accent/10 text-accent-light hover:bg-accent/20"
              }`}>
              <Check className="h-4 w-4" />
              {record.refundReceived ? "Refund received" : "Mark refund received"}
            </button>
          </div>
        </div>
        <p className="mt-3 text-[10px] text-foreground/35">
          When marked received, the estimated refund is added to the Planner as income on the received date. Unmarking it removes that Planner income event.
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
