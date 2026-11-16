import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSpendingFlow, type FlowTransaction } from "../src/lib/spending-flow.ts";

function tx(overrides: Partial<FlowTransaction>): FlowTransaction {
  return {
    amount: 0, name: "Transaction", merchant_name: null, category: "other",
    transaction_type: "expense", is_ignored: false, ...overrides,
  };
}

test("groups income and expense transactions and excludes transfers and ignored rows", () => {
  const flow = buildSpendingFlow([
    tx({ name: "Salary", transaction_type: "income", amount: -2000 }),
    tx({ name: "salary", transaction_type: "income", amount: -500 }),
    tx({ category: "groceries", amount: 300 }),
    tx({ category: "groceries", amount: 50 }),
    tx({ category: "travel", amount: 150 }),
    tx({ transaction_type: "transfer", amount: 800 }),
    tx({ is_ignored: true, amount: 600 }),
  ]);
  assert.equal(flow.totalIncome, 2500);
  assert.equal(flow.totalExpenses, 500);
  assert.equal(flow.remainder, 2000);
  assert.equal(flow.shortfall, 0);
  assert.deepEqual(flow.sources.map(item => item.amount), [2500]);
  assert.deepEqual(flow.categories.map(item => item.amount), [350, 150]);
});

test("shows expenses exceeding recorded income as a shortfall", () => {
  const flow = buildSpendingFlow([tx({ amount: 120 })]);
  assert.equal(flow.shortfall, 120);
  assert.equal(flow.remainder, 0);
});

test("handles income-only and empty periods", () => {
  const flow = buildSpendingFlow([tx({ transaction_type: "income", amount: -75 })]);
  assert.equal(flow.remainder, 75);
  assert.equal(buildSpendingFlow([]).totalIncome, 0);
  assert.equal(buildSpendingFlow([]).totalExpenses, 0);
});
