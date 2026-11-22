import assert from "node:assert/strict";
import test from "node:test";
import {
  constantTimeEqual,
  resolveNamedEntity,
  summarizeTransactions,
} from "../supabase/functions/beancount-mcp/helpers.ts";

test("resolveNamedEntity resolves exact id, exact name, and unique partial match", () => {
  const accounts = [
    { id: "1", name: "Chase Checking" },
    { id: "2", name: "Chase Savings" },
    { id: "3", name: "Robinhood" },
  ];

  const byId = resolveNamedEntity(accounts, "2", undefined, "account");
  assert.equal(byId.ok, true);
  if (byId.ok) assert.equal(byId.match.name, "Chase Savings");

  const byExact = resolveNamedEntity(accounts, undefined, "chase checking", "account");
  assert.equal(byExact.ok, true);
  if (byExact.ok) assert.equal(byExact.match.id, "1");

  const byPartial = resolveNamedEntity(accounts, undefined, "robin", "account");
  assert.equal(byPartial.ok, true);
  if (byPartial.ok) assert.equal(byPartial.match.id, "3");
});

test("resolveNamedEntity rejects ambiguous partial names instead of guessing", () => {
  const accounts = [
    { id: "1", name: "Chase Checking" },
    { id: "2", name: "Chase Savings" },
  ];
  const res = resolveNamedEntity(accounts, undefined, "Chase", "account");
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.error, /Ambiguous/);
});

test("constantTimeEqual compares tokens accurately", () => {
  assert.equal(constantTimeEqual("secret123", "secret123"), true);
  assert.equal(constantTimeEqual("secret123", "secret124"), false);
  assert.equal(constantTimeEqual("short", "longer"), false);
});

test("summarizeTransactions aggregates income, expenses, transfers, and ignores flagged rows", () => {
  const summary = summarizeTransactions([
    { amount: 5000, category: "income", transaction_type: "income" },
    { amount: 120.5, category: "groceries", transaction_type: "expense" },
    { amount: 45, category: "food_and_drink", transaction_type: "expense" },
    { amount: 30, category: "groceries", transaction_type: "expense" },
    { amount: 500, category: "transfer_out", transaction_type: "transfer" },
    { amount: 999, category: "shopping", transaction_type: "expense", is_ignored: true },
  ]);

  assert.equal(summary.income, 5000);
  assert.equal(summary.expenses, 195.5);
  assert.equal(summary.net, 4804.5);
  assert.equal(summary.transfers, 500);
  assert.deepEqual(summary.categories, [
    { category: "groceries", total: 150.5 },
    { category: "food_and_drink", total: 45 },
  ]);
});
