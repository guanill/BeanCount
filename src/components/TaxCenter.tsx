"use client";

import { useEffect, useMemo, useState } from "react";
import { Calculator, Check, Loader2, Plus } from "lucide-react";
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
}

interface TaxConfig {
  taxYearTracking?: Record<string, TaxYearRecord>;
  events?: Array<{ id: string; year: number; month: number; label: string; amount: number; type: string }>;
}

type TaxInputKey = Exclude<keyof TaxYearRecord, "refundReceived">;

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 5 }, (_, index) => CURRENT_YEAR - 1 + index);

function amount(value: string | undefined): number {
  return Math.max(0, parseFloat(value ?? "") || 0);
}

export default function TaxCenter() {
  const [year, setYear] = useState(CURRENT_YEAR);
  const [record, setRecord] = useState<TaxYearRecord>({});
  const [filingStatus, setFilingStatus] = useState<FilingStatus>("single");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const row = await getPlannerConfig(createClient());
        if (!cancelled) {
          const config = (row?.config ?? {}) as TaxConfig;
          setRecord(config.taxYearTracking?.[String(year)] ?? {});
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
    const income = amount(record.actualGrossIncome) + amount(record.expectedRemainingGross);
    const withholding = amount(record.actualWithholding) + amount(record.expectedRemainingWithholding);
    const investments = amount(record.investmentProceeds) - amount(record.investmentCostBasis);
    return { income, withholding, investments };
  }, [record]);

  const estimatedRefund = useMemo(() => {
    const gross = amount(record.actualGrossIncome) + amount(record.expectedRemainingGross);
    if (gross <= 0) return null;
    const tax = computeAnnualTax(gross, filingStatus, year);
    if (!tax) return null;
    const paid = amount(record.actualWithholding) + amount(record.expectedRemainingWithholding)
      + amount(record.estimatedPayments) + amount(record.taxCredits);
    return paid - tax.total;
  }, [filingStatus, record, year]);

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
      const current = config.taxYearTracking?.[String(year)] ?? record;
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
          <p className="mt-1 max-w-2xl text-sm text-foreground/50">Keep pay-stub totals, investment activity, deductions, and payments together for each tax year.</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={year} onChange={event => setYear(Number(event.target.value))} className="rounded-xl border border-border/50 bg-card px-3 py-2 text-sm text-foreground">
            {YEAR_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
          </select>
          <button onClick={save} disabled={saving} className="flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
          </button>
        </div>
      </div>

      {message && <p className="rounded-lg border border-accent/20 bg-accent/5 px-3 py-2 text-xs text-accent-light">{message}</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          ["Income planned", totals.income, "text-green"],
          ["Withholding planned", totals.withholding, "text-rose-400"],
          ["Investment gain/loss", totals.investments, totals.investments >= 0 ? "text-green" : "text-red"],
        ].map(([label, value, color]) => (
          <div key={String(label)} className="rounded-2xl border border-border/40 bg-card p-4">
            <p className="text-[10px] uppercase tracking-wider text-foreground/40">{label}</p>
            <p className={`mt-1 text-xl font-bold tabular-nums ${color}`}>{formatCurrency(Number(value))}</p>
          </div>
        ))}
      </div>

      <section className="rounded-2xl border border-border/40 bg-card p-4 sm:p-5">
        <div className="mb-4 flex items-center gap-2"><Calculator className="h-4 w-4 text-accent-light" /><h3 className="font-semibold text-foreground">Income and withholding</h3></div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {field("actualGrossIncome", "Actual gross income to date", "Pay stubs")}
          {field("expectedRemainingGross", "Expected remaining gross", "Future pay")}
          {field("actualWithholding", "Tax withheld to date", "Pay stubs")}
          {field("expectedRemainingWithholding", "Expected remaining withholding", "Future pay")}
        </div>
      </section>

      <section className="rounded-2xl border border-border/40 bg-card p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-foreground">Refund timing</h3>
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
              className="mt-1 w-full rounded-lg border border-border/50 bg-background px-2.5 py-2 text-xs text-foreground" />
          </label>
          <label className="text-[10px] text-foreground/50">
            Received date
            <input type="date" value={record.refundReceivedDate ?? ""} disabled={!record.refundReceived}
              onChange={event => update("refundReceivedDate", event.target.value)}
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

      <section className="rounded-2xl border border-border/40 bg-card p-4 sm:p-5">
        <div className="mb-4 flex items-center gap-2"><Plus className="h-4 w-4 text-accent-light" /><h3 className="font-semibold text-foreground">Investments and other tax items</h3></div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {field("investmentProceeds", "Stock/crypto sale proceeds", "Total sales")}
          {field("investmentCostBasis", "Stock/crypto cost basis", "What you paid")}
          {field("realizedCapitalGain", "Realized capital gain/loss", "Optional override")}
          {field("dividends", "Dividends and distributions", "Brokerage forms")}
          {field("deductions", "Deductions", "Itemized or other")}
          {field("taxCredits", "Tax credits", "Credits")}
          {field("estimatedPayments", "Estimated tax payments", "Payments")}
        </div>
        <p className="mt-3 text-[10px] leading-relaxed text-foreground/35">Use your brokerage 1099 forms for proceeds, cost basis, realized gains, and dividends. These entries are tracking data and do not replace tax filing advice.</p>
      </section>
    </div>
  );
}
