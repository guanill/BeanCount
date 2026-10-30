export interface SalaryPeriodLike {
  startYear: number;
  startMonth: number;
  monthlySalary: number;
  payFrequency?: "monthly" | "semimonthly" | "biweekly" | "weekly";
  payDay1?: number;
  payDay2?: number;
}

export interface RecurringChargeLike {
  amount: number;
  startYear?: number;
  startMonth?: number;
  durationMonths?: number | null;
  chargeDay?: number;
  paidOverride?: { month: string; paid: boolean };
}

export function togglePaydayStatus(
  day: number,
  paidPaydays: number[],
  unpaidPaydays: number[],
): { paidPaydays: number[]; unpaidPaydays: number[] } {
  const isPaid = paidPaydays.includes(day) && !unpaidPaydays.includes(day);
  return isPaid
    ? {
        paidPaydays: paidPaydays.filter(value => value !== day),
        unpaidPaydays: [...new Set([...unpaidPaydays, day])],
      }
    : {
        paidPaydays: [...new Set([...paidPaydays, day])],
        unpaidPaydays: unpaidPaydays.filter(value => value !== day),
      };
}

export function getSalaryForMonth(periods: SalaryPeriodLike[], year: number, month: number): number {
  const applicable = periods
    .filter(p => p.startYear < year || (p.startYear === year && p.startMonth <= month))
    .sort((a, b) => (a.startYear * 12 + a.startMonth) - (b.startYear * 12 + b.startMonth));
  return applicable.length > 0 ? applicable[applicable.length - 1].monthlySalary : 0;
}

export function salaryPaidThisMonth(period: SalaryPeriodLike, now: Date = new Date()): boolean {
  const frequency = period.payFrequency ?? "monthly";
  const dayOfMonth = now.getDate();
  if (frequency === "monthly" || frequency === "semimonthly") {
    return dayOfMonth >= (period.payDay1 ?? 15) ||
      (frequency === "semimonthly" && dayOfMonth >= (period.payDay2 ?? 30));
  }
  return dayOfMonth >= (period.payDay1 ?? 15);
}

export function chargeActiveInMonth(c: RecurringChargeLike, year: number, month: number): boolean {
  const ord = year * 12 + month;
  const hasStart = !!(c.startYear && c.startMonth);
  if (hasStart && ord < c.startYear! * 12 + c.startMonth!) return false;
  if (hasStart && c.durationMonths && c.durationMonths > 0) {
    const end = c.startYear! * 12 + c.startMonth! + c.durationMonths - 1;
    if (ord > end) return false;
  }
  return true;
}

export function chargesForMonth(charges: RecurringChargeLike[], year: number, month: number): number {
  return charges.reduce((sum, charge) =>
    sum + (chargeActiveInMonth(charge, year, month) ? charge.amount : 0), 0);
}

export function chargePaidThisMonth(c: RecurringChargeLike, txSeen: boolean, now: Date = new Date()): boolean {
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  if (c.paidOverride && c.paidOverride.month === monthKey) return c.paidOverride.paid;
  if (txSeen) return true;
  if (c.chargeDay != null && now.getDate() >= c.chargeDay) return true;
  return false;
}

export function chargeEndMonth(c: RecurringChargeLike): { year: number; month: number } | null {
  if (!c.startYear || !c.startMonth || !c.durationMonths || c.durationMonths <= 0) return null;
  const total = (c.startMonth - 1) + c.durationMonths - 1;
  return { year: c.startYear + Math.floor(total / 12), month: (total % 12) + 1 };
}

export interface LoanLike {
  balance: number;
  interest_rate: number;
  monthly_payment: number;
  deferral_months: number | null;
  deferral_type?: string | null;
  created_at: string | null;
}

export function loanPaymentForMonth(
  loan: Pick<LoanLike, "monthly_payment" | "deferral_months" | "created_at">,
  year: number,
  month: number,
): number {
  const defMonths = loan.deferral_months ?? 0;
  if (!defMonths) return loan.monthly_payment;
  const created = loan.created_at ? new Date(loan.created_at) : null;
  if (!created || isNaN(created.getTime())) return loan.monthly_payment;
  const firstPayYear = created.getFullYear() + Math.floor((created.getMonth() + defMonths) / 12);
  const firstPayMonth = ((created.getMonth() + defMonths) % 12) + 1;
  return (year > firstPayYear || (year === firstPayYear && month >= firstPayMonth))
    ? loan.monthly_payment : 0;
}

export function isLoanPaidOffBy(override: string | undefined, year: number, month: number): boolean {
  if (!override) return false;
  const [oy, om] = override.split("-").map(Number);
  if (!oy || !om) return false;
  return year * 12 + month >= oy * 12 + om;
}

export function isLoanPayoffMonth(override: string | undefined, year: number, month: number): boolean {
  if (!override) return false;
  const [oy, om] = override.split("-").map(Number);
  return oy === year && om === month;
}

export function loanNaturalPayoffMonth(
  loan: LoanLike,
  now: Date = new Date(),
): { year: number; month: number } | null {
  if (loan.balance <= 0 || loan.monthly_payment <= 0) return null;
  const r = (loan.interest_rate ?? 0) / 100 / 12;
  const subsidized = (loan.deferral_type ?? "unsubsidized") === "subsidized";
  const created = loan.created_at ? new Date(loan.created_at) : now;
  const defMonths = loan.deferral_months ?? 0;
  const firstPay = defMonths > 0 ? new Date(created.getFullYear(), created.getMonth() + defMonths, 1) : null;
  let bal = loan.balance;
  let y = now.getFullYear();
  let m = now.getMonth() + 1;
  let last: { year: number; month: number } | null = null;
  for (let i = 0; i < 720; i++) {
    if (bal <= 0.005) break;
    const stepDate = new Date(y, m - 1, 1);
    const inDeferral = firstPay && stepDate < firstPay;
    if (inDeferral) {
      if (!subsidized && r > 0) bal += bal * r;
    } else {
      const interest = r > 0 ? bal * r : 0;
      if (loan.monthly_payment <= interest && bal > 0) return null;
      const payment = Math.min(loan.monthly_payment, bal + interest);
      bal = Math.max(0, bal - (payment - interest));
      last = { year: y, month: m };
      if (bal <= 0.005) break;
    }
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return last;
}

export function isAfterPayoff(end: { year: number; month: number } | null, year: number, month: number): boolean {
  return !!end && year * 12 + month > end.year * 12 + end.month;
}

export function projectLoanBalanceAt(
  loan: LoanLike,
  targetYear: number,
  targetMonth: number,
  now: Date = new Date(),
): number {
  const monthsAhead = (targetYear - now.getFullYear()) * 12 + (targetMonth - 1 - now.getMonth());
  if (monthsAhead <= 0 || loan.balance <= 0) return Math.max(0, loan.balance);
  const r = (loan.interest_rate ?? 0) / 100 / 12;
  const defMonths = loan.deferral_months ?? 0;
  const subsidized = (loan.deferral_type ?? "unsubsidized") === "subsidized";
  const created = loan.created_at ? new Date(loan.created_at) : now;
  const firstPay = defMonths > 0 ? new Date(created.getFullYear(), created.getMonth() + defMonths, 1) : null;
  let bal = loan.balance;
  for (let i = 0; i < monthsAhead; i++) {
    if (bal <= 0) break;
    const step = new Date(now.getFullYear(), now.getMonth() + i + 1, 1);
    const inDeferral = firstPay && step < firstPay;
    if (inDeferral) {
      if (!subsidized && r > 0) bal += bal * r;
    } else {
      const interest = r > 0 ? bal * r : 0;
      const payment = Math.min(loan.monthly_payment, bal + interest);
      bal = Math.max(0, bal - (payment - interest));
    }
  }
  return Math.round(bal * 100) / 100;
}
