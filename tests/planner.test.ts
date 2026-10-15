import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chargeActiveInMonth,
  chargesForMonth,
  projectLoanBalanceAt,
  salaryPaidThisMonth,
} from "../src/lib/planner.ts";
import { formatDate, parseDateOnly } from "../src/lib/format.ts";

test("recurring charges respect their start and duration", () => {
  const charge = { amount: 100, startYear: 2026, startMonth: 3, durationMonths: 3 };
  assert.equal(chargeActiveInMonth(charge, 2026, 2), false);
  assert.equal(chargeActiveInMonth(charge, 2026, 3), true);
  assert.equal(chargeActiveInMonth(charge, 2026, 5), true);
  assert.equal(chargeActiveInMonth(charge, 2026, 6), false);
  assert.equal(chargesForMonth([charge], 2026, 4), 100);
});

test("salary payday supports semimonthly schedules", () => {
  const schedule = { startYear: 2026, startMonth: 1, monthlySalary: 5000, payFrequency: "semimonthly" as const, payDay1: 15, payDay2: 30 };
  assert.equal(salaryPaidThisMonth(schedule, new Date(2026, 0, 14)), false);
  assert.equal(salaryPaidThisMonth(schedule, new Date(2026, 0, 15)), true);
});

test("loan payoff projection never returns a negative balance", () => {
  const loan = { balance: 1000, interest_rate: 0, monthly_payment: 600, deferral_months: 0, created_at: "2026-01-01" };
  assert.equal(projectLoanBalanceAt(loan, 2026, 4, new Date(2026, 0, 1)), 0);
});

test("date-only values remain on their calendar day", () => {
  const date = parseDateOnly("2026-10-14");
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 9);
  assert.equal(date.getDate(), 14);
  assert.match(formatDate("2026-10-14"), /Oct 14, 2026/);
});
