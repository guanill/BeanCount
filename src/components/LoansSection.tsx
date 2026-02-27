"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Plus, Pencil, Trash2, TrendingDown,
  Zap, ChevronDown, ChevronUp,
} from "lucide-react";
import { Loan } from "@/lib/types";
import { formatCurrency } from "@/lib/format";

// ─── Loan types ───────────────────────────────────────────────────────────────
const LOAN_TYPES = [
  { value: "mortgage",   label: "Mortgage",           emoji: "🏠" },
  { value: "auto",       label: "Auto Loan",          emoji: "🚗" },
  { value: "student",    label: "Student Loan",       emoji: "🎓" },
  { value: "personal",   label: "Personal Loan",      emoji: "💼" },
  { value: "medical",    label: "Medical",            emoji: "🏥" },
  { value: "business",   label: "Business",           emoji: "🏢" },
  { value: "short_term", label: "Short-Term / BNPL",  emoji: "🛍️" },
  { value: "other",      label: "Other",              emoji: "📌" },
];
function getLoanMeta(type: string) {
  return LOAN_TYPES.find(t => t.value === type) ?? LOAN_TYPES[LOAN_TYPES.length - 1];
}

const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ─── Amort math ───────────────────────────────────────────────────────────────
interface AmortRow { month: number; payment: number; principal: number; interest: number; balance: number; deferred?: boolean; }

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

  // ── Deferral phase (no payments — interest accrues if unsubsidized)
  for (let m = 1; m <= deferralMonths; m++) {
    const interest = (!subsidized && r > 0) ? bal * r : 0;
    bal += interest; // capitalize unsubsidized interest
    rows.push({ month: m, payment: 0, principal: 0, interest, balance: bal, deferred: true });
  }

  // ── Repayment phase
  for (let m = 1; m <= maxMonths; m++) {
    const interest = r > 0 ? bal * r : 0;
    const actualPay = Math.min(Math.max(monthlyPayment, interest + 0.01), bal + interest);
    const principal = actualPay - interest;
    bal = Math.max(bal - principal, 0);
    rows.push({ month: deferralMonths + m, payment: actualPay, principal, interest, balance: bal });
    if (bal <= 0.005) break;
  }
  return rows;
}

function totalInterest(rows: AmortRow[]) { return rows.reduce((s, r) => s + r.interest, 0); }
function payoffLabel(months: number) {
  if (months <= 0) return "Paid off";
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m}mo`;
  if (m === 0) return `${y}yr`;
  return `${y}yr ${m}mo`;
}

// ─── Types ────────────────────────────────────────────────────────────────────
const EMPTY_FORM = {
  name: "", type: "personal", balance: "", original_amount: "",
  interest_rate: "", monthly_payment: "", notes: "",
  deferral_months: "0", deferral_type: "unsubsidized" as "subsidized" | "unsubsidized",
};

// ─── Payoff chart ─────────────────────────────────────────────────────────────
function PayoffChart({ rows, extraRows }: { rows: AmortRow[]; extraRows: AmortRow[] }) {
  const allRows = rows.length > 0 ? rows : [];
  const total = allRows.length;
  if (total === 0) return <div className="h-32 flex items-center justify-center text-foreground/30 text-sm">No data</div>;

  // Sample ~24 points for the chart
  const step = Math.max(1, Math.floor(total / 24));
  const points = allRows.filter((_, i) => i % step === 0 || i === total - 1);
  const extraPoints = extraRows.filter((_, i) => i % step === 0 || i === extraRows.length - 1);

  const maxBal = allRows[0].balance + allRows[0].principal + allRows[0].interest;
  const w = 100; const h = 80;

  function toX(month: number) { return (month / Math.max(rows.length, extraRows.length)) * w; }
  function toY(bal: number) { return h - (bal / maxBal) * h; }

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${toX(p.month).toFixed(1)},${toY(p.balance).toFixed(1)}`).join(" ");
  const extraPath = extraPoints.length > 0
    ? extraPoints.map((p, i) => `${i === 0 ? "M" : "L"}${toX(p.month).toFixed(1)},${toY(p.balance).toFixed(1)}`).join(" ")
    : null;

  const areaPath = path + ` L${toX(points[points.length - 1].month).toFixed(1)},${h} L0,${h} Z`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-32" preserveAspectRatio="none">
      <defs>
        <linearGradient id="loanGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6c5ce7" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#6c5ce7" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#loanGrad)" />
      <path d={path} fill="none" stroke="#6c5ce7" strokeWidth="0.8" />
      {extraPath && (
        <path d={extraPath} fill="none" stroke="#00b894" strokeWidth="0.8" strokeDasharray="2,1" />
      )}
    </svg>
  );
}

// ─── Single Loan Card ─────────────────────────────────────────────────────────
function LoanCard({ loan, onRefresh }: { loan: Loan; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing]   = useState(false);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [extraPayment, setExtraPayment] = useState(0);

  const meta = getLoanMeta(loan.type);
  const deferralMonths = loan.deferral_months ?? 0;
  const subsidized     = (loan.deferral_type ?? "unsubsidized") === "subsidized";

  const baseRows  = useMemo(() => buildAmortSchedule(loan.balance, loan.interest_rate, loan.monthly_payment, 600, deferralMonths, subsidized), [loan, deferralMonths, subsidized]);
  const extraRows = useMemo(() => extraPayment > 0
    ? buildAmortSchedule(loan.balance, loan.interest_rate, loan.monthly_payment + extraPayment, 600, deferralMonths, subsidized)
    : [], [loan, extraPayment, deferralMonths, subsidized]);

  const baseInterest  = totalInterest(baseRows);
  const extraInterest = totalInterest(extraRows);
  const interestSaved = extraPayment > 0 ? baseInterest - extraInterest : 0;
  const monthsSaved   = extraPayment > 0 ? baseRows.length - extraRows.length : 0;

  const progress = loan.original_amount && loan.original_amount > 0
    ? Math.min(100, ((loan.original_amount - loan.balance) / loan.original_amount) * 100)
    : null;

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
    await fetch(`/api/loans/${loan.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editForm.name, type: editForm.type,
        balance: parseFloat(editForm.balance) || 0,
        original_amount: editForm.original_amount ? parseFloat(editForm.original_amount) : null,
        interest_rate: parseFloat(editForm.interest_rate) || 0,
        monthly_payment: parseFloat(editForm.monthly_payment) || 0,
        notes: editForm.notes || null,
        deferral_months: parseInt(editForm.deferral_months) || 0,
        deferral_type: editForm.deferral_type,
      }),
    });
    setEditing(false);
    onRefresh();
  }

  async function handleDelete() {
    if (!confirm(`Delete "${loan.name}"?`)) return;
    await fetch(`/api/loans/${loan.id}`, { method: "DELETE" });
    onRefresh();
  }

  // Monthly breakdown table — show first 12 months + last month when expanded
  const tableRows = expanded
    ? [...baseRows.slice(0, 24), ...(baseRows.length > 24 ? [baseRows[baseRows.length - 1]] : [])]
    : baseRows.slice(0, 6);

  return (
    <div className="rounded-2xl bg-card border border-border/50 overflow-hidden">
      {/* Card header */}
      <div className="p-5">
        {editing ? (
          <form onSubmit={handleUpdate} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs text-foreground/50 block mb-1">Loan Name</label>
                <input type="text" value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                  className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" required />
              </div>
              <div>
                <label className="text-xs text-foreground/50 block mb-1">Type</label>
                <select value={editForm.type} onChange={e => setEditForm({ ...editForm, type: e.target.value })}
                  className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent">
                  {LOAN_TYPES.map(t => <option key={t.value} value={t.value}>{t.emoji} {t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-foreground/50 block mb-1">Current Balance ($)</label>
                <input type="number" step="0.01" value={editForm.balance} onChange={e => setEditForm({ ...editForm, balance: e.target.value })}
                  className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" required />
              </div>
              <div>
                <label className="text-xs text-foreground/50 block mb-1">Original Amount ($)</label>
                <input type="number" step="0.01" value={editForm.original_amount} onChange={e => setEditForm({ ...editForm, original_amount: e.target.value })}
                  className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" placeholder="Optional" />
              </div>
              <div>
                <label className="text-xs text-foreground/50 block mb-1">Annual Interest Rate (%)</label>
                <input type="number" step="0.01" value={editForm.interest_rate} onChange={e => setEditForm({ ...editForm, interest_rate: e.target.value })}
                  className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" required />
              </div>
              <div>
                <label className="text-xs text-foreground/50 block mb-1">Monthly Payment ($)</label>
                <input type="number" step="0.01" value={editForm.monthly_payment} onChange={e => setEditForm({ ...editForm, monthly_payment: e.target.value })}
                  className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" required />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-foreground/50 block mb-1">Notes</label>
                <input type="text" value={editForm.notes} onChange={e => setEditForm({ ...editForm, notes: e.target.value })}
                  className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" />
              </div>
              {/* Deferral */}
              <div className="col-span-2 pt-2 border-t border-border/30">
                <p className="text-xs text-foreground/50 font-semibold mb-2">🎓 Deferment <span className="font-normal text-foreground/30">(student / forbearance)</span></p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-foreground/50 block mb-1">Deferred months remaining</label>
                    <input type="number" min={0} max={60} value={editForm.deferral_months}
                      onChange={e => setEditForm({ ...editForm, deferral_months: e.target.value })}
                      className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" />
                    <p className="text-[10px] text-foreground/30 mt-0.5">Set 0 to disable deferment</p>
                  </div>
                  <div>
                    <label className="text-xs text-foreground/50 block mb-1">Subsidy type</label>
                    <div className="flex gap-2 mt-1">
                      {(["subsidized", "unsubsidized"] as const).map(t => (
                        <button key={t} type="button"
                          onClick={() => setEditForm({ ...editForm, deferral_type: t })}
                          className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                            editForm.deferral_type === t
                              ? "bg-violet-500/15 border-violet-500/40 text-violet-400"
                              : "bg-background border-border/40 text-foreground/40 hover:border-border/70"
                          }`}>
                          {t === "subsidized" ? "Subsidized" : "Unsubsidized"}
                        </button>
                      ))}
                    </div>
                    <p className="text-[10px] text-foreground/30 mt-1">
                      {editForm.deferral_type === "subsidized" ? "Interest paid by govt — balance stays flat 👍" : "Interest accrues — balance grows during deferment ⚠️"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button type="submit" className="px-4 py-1.5 bg-accent text-white rounded-lg text-sm hover:bg-accent-light transition-colors">Save</button>
              <button type="button" onClick={() => setEditing(false)} className="px-3 py-1.5 text-foreground/50 hover:text-foreground text-sm transition-colors">Cancel</button>
            </div>
          </form>
        ) : (
          <>
            {/* Title row */}
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-accent/20 flex items-center justify-center text-xl">
                  {meta.emoji}
                </div>
                <div>
                  <h3 className="font-bold text-foreground">{loan.name}</h3>
                  <p className="text-xs text-foreground/40">
                    {meta.label} · {loan.interest_rate}% APR
                    {deferralMonths > 0 && (
                      <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-400 text-[10px] font-semibold">
                        ⏸ Deferred {deferralMonths}mo
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={startEdit} className="p-1.5 text-foreground/30 hover:text-accent transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                <button onClick={handleDelete} className="p-1.5 text-foreground/30 hover:text-red-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>

            {/* Key stats */}
            <div className={`grid gap-3 mb-4 ${deferralMonths > 0 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}>
              <div className="bg-background/60 rounded-xl p-3 text-center">
                <p className="text-xs text-foreground/40 mb-1">Balance</p>
                <p className="text-base font-bold text-red-400">{formatCurrency(loan.balance)}</p>
              </div>
              <div className="bg-background/60 rounded-xl p-3 text-center">
                <p className="text-xs text-foreground/40 mb-1">{deferralMonths > 0 ? "Payment after" : "Monthly"}</p>
                <p className="text-base font-bold text-foreground">{formatCurrency(loan.monthly_payment)}</p>
              </div>
              {deferralMonths > 0 && (() => {
                const balAfterDeferral = baseRows[deferralMonths - 1]?.balance ?? loan.balance;
                return (
                  <div className="bg-yellow-500/10 rounded-xl p-3 text-center border border-yellow-500/20">
                    <p className="text-xs text-yellow-400/70 mb-1">After deferment</p>
                    <p className="text-base font-bold text-yellow-400">{formatCurrency(balAfterDeferral)}</p>
                    {!subsidized && balAfterDeferral > loan.balance && (
                      <p className="text-[10px] text-yellow-400/60">+{formatCurrency(balAfterDeferral - loan.balance)} interest</p>
                    )}
                  </div>
                );
              })()}
              <div className="bg-background/60 rounded-xl p-3 text-center">
                <p className="text-xs text-foreground/40 mb-1">Payoff</p>
                <p className="text-base font-bold text-accent-light">{payoffLabel(baseRows.length)}</p>
              </div>
            </div>

            {/* Short-term / BNPL banner */}
            {loan.type === "short_term" && (() => {
              const totalInstallments = loan.original_amount && loan.monthly_payment > 0
                ? Math.round(loan.original_amount / loan.monthly_payment)
                : baseRows.length;
              const paidInstallments = Math.max(0, totalInstallments - baseRows.length);
              const dots = Array.from({ length: Math.min(totalInstallments, 12) });
              return (
                <div className="mb-4 p-3 rounded-xl bg-cyan-500/8 border border-cyan-500/20">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-base">🛍️</span>
                    <p className="text-xs font-semibold text-cyan-400">
                      Short-Term / Buy Now Pay Later
                    </p>
                    {loan.interest_rate === 0 && (
                      <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 border border-green-500/30">0% interest</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {dots.map((_, i) => (
                      <div
                        key={i}
                        className={`h-2 flex-1 min-w-[18px] rounded-full transition-all ${
                          i < paidInstallments
                            ? "bg-cyan-400/80"
                            : "bg-cyan-500/20 border border-cyan-500/30"
                        }`}
                      />
                    ))}
                    {totalInstallments > 12 && (
                      <span className="text-[10px] text-foreground/30">+{totalInstallments - 12} more</span>
                    )}
                  </div>
                  <p className="text-[11px] text-foreground/50 mt-1.5">
                    {paidInstallments} of {totalInstallments} payment{totalInstallments !== 1 ? "s" : ""} made
                    {" · "}{baseRows.length} remaining
                    {" · "}{formatCurrency(loan.monthly_payment)} each
                  </p>
                </div>
              );
            })()}

            {/* Deferral info banner */}
            {deferralMonths > 0 && (
              <div className="mb-4 p-3 rounded-xl bg-yellow-500/8 border border-yellow-500/20 flex items-start gap-2.5">
                <span className="text-lg mt-0.5">⏸</span>
                <div className="text-xs space-y-0.5">
                  <p className="font-semibold text-yellow-400">
                    {subsidized ? "Subsidized deferment" : "Unsubsidized deferment"} — {deferralMonths} month{deferralMonths !== 1 ? "s" : ""} remaining
                  </p>
                  <p className="text-foreground/50">
                    {subsidized
                      ? `No payments or interest for ${deferralMonths} months. Your balance stays at ${formatCurrency(loan.balance)}.`
                      : `No payments for ${deferralMonths} months, but interest keeps accruing. Your balance will grow to ${formatCurrency(baseRows[deferralMonths - 1]?.balance ?? loan.balance)}.`}
                  </p>
                </div>
              </div>
            )}

            {/* Progress bar */}
            {progress !== null && (
              <div className="mb-4">
                <div className="flex items-center justify-between text-xs text-foreground/40 mb-1">
                  <span>Paid off</span>
                  <span>{progress.toFixed(1)}%</span>
                </div>
                <div className="h-2 bg-background rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progress}%` }} />
                </div>
              </div>
            )}

            {/* Chart + summary */}
            <div className="mb-4">
              <div className="flex items-center justify-between text-xs text-foreground/40 mb-1">
                <span>Balance over time</span>
                <span>Total interest: <span className="text-red-400 font-semibold">{formatCurrency(baseInterest)}</span></span>
              </div>
              <PayoffChart rows={baseRows} extraRows={extraRows} />
              {extraPayment > 0 && (
                <p className="text-xs text-green-400 mt-1 text-right">
                  +{formatCurrency(extraPayment)}/mo saves {formatCurrency(interestSaved)} · pays off {monthsSaved}mo sooner
                </p>
              )}
            </div>

            {/* Extra payment slider */}
            <div className="mb-4 p-3 bg-background/60 rounded-xl border border-border/30">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-foreground/70 flex items-center gap-1"><Zap className="w-3 h-3 text-yellow-400" /> Extra payment / month</label>
                <span className="text-sm font-bold text-yellow-400">+{formatCurrency(extraPayment)}</span>
              </div>
              <input
                type="range" min={0} max={Math.max(loan.monthly_payment * 3, 1000)} step={10}
                value={extraPayment}
                onChange={e => setExtraPayment(Number(e.target.value))}
                className="w-full accent-yellow-400"
              />
              <div className="flex justify-between text-xs text-foreground/30 mt-1">
                <span>$0</span><span>{formatCurrency(Math.max(loan.monthly_payment * 3, 1000))}</span>
              </div>
            </div>

            {/* Amort table toggle */}
            <button
              onClick={() => setExpanded(v => !v)}
              className="w-full flex items-center justify-center gap-1.5 text-xs text-foreground/40 hover:text-foreground transition-colors py-1"
            >
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              {expanded ? "Hide" : "Show"} amortization schedule
            </button>

            {/* Amort table */}
            {expanded && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-foreground/40 border-b border-border/30">
                      <th className="text-left pb-2 pr-3">Month</th>
                      <th className="text-right pb-2 pr-3">Payment</th>
                      <th className="text-right pb-2 pr-3">Principal</th>
                      <th className="text-right pb-2 pr-3">Interest</th>
                      <th className="text-right pb-2">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((row, i) => {
                      const isLast = i === tableRows.length - 1 && baseRows.length > tableRows.length;
                      return (
                        <>
                          {isLast && (
                            <tr key="ellipsis"><td colSpan={5} className="text-center text-foreground/20 py-2">· · ·</td></tr>
                          )}
                          <tr key={row.month} className={`border-b border-border/10 ${row.deferred ? "bg-yellow-500/5" : "hover:bg-card-hover/30"}`}>
                            <td className={`py-1.5 pr-3 ${row.deferred ? "text-yellow-400/60" : "text-foreground/50"}`}>
                              {(() => {
                                const now = new Date();
                                const d = new Date(now.getFullYear(), now.getMonth() + row.month - 1);
                                return `${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
                              })()}
                              {row.deferred && <span className="ml-1 text-[9px] text-yellow-400/50 font-semibold">DEFERRED</span>}
                            </td>
                            <td className={`text-right pr-3 ${row.deferred ? "text-yellow-400/50" : "text-foreground"}`}>
                              {row.deferred ? "—" : formatCurrency(row.payment)}
                            </td>
                            <td className={`text-right pr-3 ${row.deferred ? "text-yellow-400/50" : "text-accent-light"}`}>
                              {row.deferred ? "—" : formatCurrency(row.principal)}
                            </td>
                            <td className={`text-right pr-3 ${row.deferred ? "text-yellow-400/60" : "text-red-400"}`}>
                              {row.interest > 0 ? formatCurrency(row.interest) : "—"}
                            </td>
                            <td className={`text-right ${row.deferred ? "text-yellow-400/60" : "text-foreground/60"}`}>{formatCurrency(row.balance)}</td>
                          </tr>
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main section ─────────────────────────────────────────────────────────────
export default function LoansSection() {
  const [loans, setLoans]   = useState<Loan[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_FORM);

  const fetchLoans = useCallback(async () => {
    const res = await fetch("/api/loans");
    const data: Loan[] = await res.json();
    setLoans(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchLoans().catch(console.error);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    await fetch("/api/loans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: addForm.name, type: addForm.type,
        balance: parseFloat(addForm.balance) || 0,
        original_amount: addForm.original_amount ? parseFloat(addForm.original_amount) : null,
        interest_rate: parseFloat(addForm.interest_rate) || 0,
        monthly_payment: parseFloat(addForm.monthly_payment) || 0,
        notes: addForm.notes || null,
        deferral_months: parseInt(addForm.deferral_months) || 0,
        deferral_type: addForm.deferral_type,
      }),
    });
    setAddForm(EMPTY_FORM);
    setAdding(false);
    fetchLoans();
  }

  const totalBalance  = loans.reduce((s, l) => s + l.balance, 0);
  const totalMonthly  = loans.reduce((s, l) => s + l.monthly_payment, 0);
  const longestPayoff = useMemo(() => {
    if (loans.length === 0) return 0;
    return Math.max(...loans.map(l =>
      buildAmortSchedule(l.balance, l.interest_rate, l.monthly_payment, 600, l.deferral_months ?? 0, (l.deferral_type ?? "unsubsidized") === "subsidized").length
    ));
  }, [loans]);

  return (
    <div className="space-y-6">
      {/* Summary hero */}
      <div className="rounded-2xl bg-linear-to-br from-violet-500/20 to-purple-600/10 border border-border/50 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2.5 rounded-xl bg-violet-500/20">
            <TrendingDown className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-foreground">Loans</h2>
            <p className="text-sm text-foreground/50">{loans.length} active loan{loans.length !== 1 ? "s" : ""}</p>
          </div>
          <button
            onClick={() => { setAdding(v => !v); setAddForm(EMPTY_FORM); }}
            className="ml-auto flex items-center gap-1.5 px-4 py-2 bg-accent text-white rounded-xl text-sm font-medium hover:bg-accent-light transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Loan
          </button>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white/5 rounded-xl p-4">
            <p className="text-white/50 text-xs uppercase tracking-wider mb-1">Total Owed</p>
            <p className="text-red-300 text-2xl font-bold">{formatCurrency(totalBalance)}</p>
          </div>
          <div className="bg-white/5 rounded-xl p-4">
            <p className="text-white/50 text-xs uppercase tracking-wider mb-1">Monthly Payments</p>
            <p className="text-white text-2xl font-bold">{formatCurrency(totalMonthly)}</p>
          </div>
          <div className="bg-white/5 rounded-xl p-4">
            <p className="text-white/50 text-xs uppercase tracking-wider mb-1">Debt Free In</p>
            <p className="text-violet-300 text-2xl font-bold">{payoffLabel(longestPayoff)}</p>
          </div>
        </div>
      </div>

      {/* Add form */}
      {adding && (
        <div className="rounded-2xl bg-card border border-border/50 p-6">
          <h3 className="font-bold text-foreground mb-4">New Loan</h3>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs text-foreground/50 block mb-1">Loan Name</label>
                <input type="text" value={addForm.name} onChange={e => setAddForm({ ...addForm, name: e.target.value })}
                  placeholder="e.g. Chase Auto Loan"
                  className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" required />
              </div>
              <div>
                <label className="text-xs text-foreground/50 block mb-1">Type</label>
                <select value={addForm.type} onChange={e => setAddForm({ ...addForm, type: e.target.value })}
                  className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent">
                  {LOAN_TYPES.map(t => <option key={t.value} value={t.value}>{t.emoji} {t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-foreground/50 block mb-1">Current Balance ($)</label>
                <input type="number" step="0.01" value={addForm.balance} onChange={e => setAddForm({ ...addForm, balance: e.target.value })}
                  className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" required />
              </div>
              <div>
                <label className="text-xs text-foreground/50 block mb-1">Original Amount ($) <span className="text-foreground/30">optional</span></label>
                <input type="number" step="0.01" value={addForm.original_amount} onChange={e => setAddForm({ ...addForm, original_amount: e.target.value })}
                  className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" />
              </div>
              <div>
                <label className="text-xs text-foreground/50 block mb-1">Annual Interest Rate (%)</label>
                <input type="number" step="0.01" value={addForm.interest_rate} onChange={e => setAddForm({ ...addForm, interest_rate: e.target.value })}
                  placeholder="e.g. 6.5"
                  className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" required />
              </div>
              <div>
                <label className="text-xs text-foreground/50 block mb-1">Monthly Payment ($)</label>
                <input type="number" step="0.01" value={addForm.monthly_payment} onChange={e => setAddForm({ ...addForm, monthly_payment: e.target.value })}
                  className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" required />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-foreground/50 block mb-1">Notes <span className="text-foreground/30">optional</span></label>
                <input type="text" value={addForm.notes} onChange={e => setAddForm({ ...addForm, notes: e.target.value })}
                  className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" />
              </div>
              {/* Deferral — always available, especially useful for student loans */}
              <div className="col-span-2 pt-2 border-t border-border/30">
                <p className="text-xs text-foreground/50 font-semibold mb-2">🎓 Deferment <span className="font-normal text-foreground/30">optional — for student loans, forbearance, etc.</span></p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-foreground/50 block mb-1">Deferred months</label>
                    <input type="number" min={0} max={60} value={addForm.deferral_months}
                      onChange={e => setAddForm({ ...addForm, deferral_months: e.target.value })}
                      placeholder="0 = not deferred"
                      className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" />
                  </div>
                  <div>
                    <label className="text-xs text-foreground/50 block mb-1">Subsidy type</label>
                    <div className="flex gap-2 mt-1">
                      {(["subsidized", "unsubsidized"] as const).map(t => (
                        <button key={t} type="button"
                          onClick={() => setAddForm({ ...addForm, deferral_type: t })}
                          className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                            addForm.deferral_type === t
                              ? "bg-violet-500/15 border-violet-500/40 text-violet-400"
                              : "bg-background border-border/40 text-foreground/40 hover:border-border/70"
                          }`}>
                          {t === "subsidized" ? "Subsidized" : "Unsubsidized"}
                        </button>
                      ))}
                    </div>
                    <p className="text-[10px] text-foreground/30 mt-1">
                      {addForm.deferral_type === "subsidized" ? "Govt pays interest — balance stays flat" : "Interest accrues and is added to balance"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button type="submit" className="px-4 py-1.5 bg-accent text-white rounded-lg text-sm hover:bg-accent-light transition-colors">Add Loan</button>
              <button type="button" onClick={() => setAdding(false)} className="px-3 py-1.5 text-foreground/50 hover:text-foreground text-sm transition-colors">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Loan cards */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-4 border-accent/30 border-t-accent rounded-full animate-spin" />
        </div>
      ) : loans.length === 0 ? (
        <div className="rounded-2xl bg-card border border-border/50 p-12 text-center">
          <div className="text-4xl mb-3">💼</div>
          <p className="text-foreground/40 text-sm">No loans yet.<br />Add one to start tracking your payoff journey.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {loans.map(loan => (
            <LoanCard key={loan.id} loan={loan} onRefresh={fetchLoans} />
          ))}
        </div>
      )}
    </div>
  );
}
