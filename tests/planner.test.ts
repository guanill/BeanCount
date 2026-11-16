import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chargeActiveInMonth,
  chargesForMonth,
  isPaydayPaid,
  projectLoanBalanceAt,
  salaryPaidThisMonth,
  togglePaydayStatus,
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

test("a later paycheck can be marked paid early, without marking the first paycheck", () => {
  const status = togglePaydayStatus(30, [], [], 10);
  assert.deepEqual(status, { paidPaydays: [30], unpaidPaydays: [] });
  assert.equal(isPaydayPaid(30, status.paidPaydays, status.unpaidPaydays, 10), true);
  assert.equal(isPaydayPaid(15, status.paidPaydays, status.unpaidPaydays, 10), false);
});

test("a payday marked paid can be explicitly toggled back to unpaid", () => {
  const status = togglePaydayStatus(30, [15, 30], [], 10);
  assert.deepEqual(status, { paidPaydays: [15], unpaidPaydays: [30] });
});

test("paychecks are automatically paid on their scheduled day each month", () => {
  for (let month = 0; month < 12; month++) {
    assert.equal(isPaydayPaid(15, [], [], new Date(2026, month, 14).getDate()), false);
    assert.equal(isPaydayPaid(15, [], [], new Date(2026, month, 15).getDate()), true);
    assert.equal(isPaydayPaid(30, [], [], new Date(2026, month, 15).getDate()), false);
  }
  assert.equal(isPaydayPaid(30, [], [], 30), true);
});

test("an automatic paid status can be overridden and restored", () => {
  const unpaid = togglePaydayStatus(15, [], [], 15);
  assert.deepEqual(unpaid, { paidPaydays: [], unpaidPaydays: [15] });
  assert.equal(isPaydayPaid(15, unpaid.paidPaydays, unpaid.unpaidPaydays, 16), false);
  const paid = togglePaydayStatus(15, unpaid.paidPaydays, unpaid.unpaidPaydays, 16);
  assert.deepEqual(paid, { paidPaydays: [15], unpaidPaydays: [] });
  assert.equal(isPaydayPaid(15, paid.paidPaydays, paid.unpaidPaydays, 16), true);
  assert.equal(isPaydayPaid(15, [15], [15], 16), false);
  assert.equal(isPaydayPaid(15, [], [], 1), false);
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
