import assert from "node:assert/strict";
import test from "node:test";
import {
  appendSplitTag,
  attachRefundTag,
  canDeleteSplitOriginal,
  classifyRefundPair,
  constantTimeEqual,
  defaultSplitNames,
  defaultTransactionTypeForCategory,
  isSplitOriginal,
  normalizeMerchantKey,
  parseRefundLink,
  rankRefundCandidates,
  removeRefundTag,
  resolveNamedEntity,
  summarizeTransactions,
  toSignedAmount,
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

test("toSignedAmount, defaultTransactionTypeForCategory, and normalizeMerchantKey match BeanCount conventions", () => {
  assert.equal(toSignedAmount(120, "income"), -120);
  assert.equal(toSignedAmount(-120, "income"), -120);
  assert.equal(toSignedAmount(-45.5, "expense"), 45.5);
  assert.equal(toSignedAmount(45.5, "transfer"), 45.5);

  assert.equal(defaultTransactionTypeForCategory("income"), "income");
  assert.equal(defaultTransactionTypeForCategory("transfer_in"), "transfer");
  assert.equal(defaultTransactionTypeForCategory("transfer_out"), "transfer");
  assert.equal(defaultTransactionTypeForCategory("groceries"), "expense");

  assert.equal(normalizeMerchantKey("  Trader Joe's #123  "), "trader joe s 123");
  assert.equal(normalizeMerchantKey("   "), null);
});

test("split transaction helpers identify originals, deletion eligibility, default names, and tags", () => {
  assert.equal(isSplitOriginal({ is_ignored: true, notes: "[split]" }), true);
  assert.equal(isSplitOriginal({ is_ignored: true, notes: "manual note" }), false);
  assert.equal(isSplitOriginal({ is_ignored: false, notes: "[split]" }), false);

  assert.equal(canDeleteSplitOriginal({ is_manual: true }), true);
  assert.equal(canDeleteSplitOriginal({ is_manual: true, import_fingerprint: "fp1" }), false);
  assert.equal(canDeleteSplitOriginal({ is_manual: false }), false);

  assert.deepEqual(defaultSplitNames("Costco"), {
    yourPart: "Costco (your part)",
    otherPart: "Costco (other part)",
  });

  assert.equal(appendSplitTag(null), "[split]");
  assert.equal(appendSplitTag("Receipt #9"), "Receipt #9 [split]");
  assert.equal(appendSplitTag("Receipt #9 [split]"), "Receipt #9 [split]");
});

test("refund tag helpers attach, parse, and remove tags without losing user notes", () => {
  const tagged = attachRefundTag("Returned jacket", {
    role: "original",
    partnerId: "tx-refund-1",
    partnerDate: "2026-11-20",
    partnerName: "REI: Co-op [Online]",
  });

  const parsed = parseRefundLink(tagged);
  assert.deepEqual(parsed, {
    role: "original",
    partnerId: "tx-refund-1",
    partnerDate: "2026-11-20",
    partnerName: "REI Co-op [Online",
  });
  assert.equal(removeRefundTag(tagged), "Returned jacket");

  const tagOnly = attachRefundTag(null, {
    role: "refund",
    partnerId: "tx-orig-1",
    partnerDate: "2026-11-18",
    partnerName: "Amazon",
  });
  assert.equal(removeRefundTag(tagOnly), null);
});

test("classifyRefundPair and rankRefundCandidates identify and rank refund pairs accurately", () => {
  const purchase = {
    id: "p1",
    name: "Amazon Marketplace",
    merchant_name: "Amazon",
    amount: 89.99,
    date: "2026-11-10",
    transaction_type: "expense",
  };
  const refund = {
    id: "r1",
    name: "Amazon Refund",
    merchant_name: "Amazon",
    amount: -89.99,
    date: "2026-11-14",
    transaction_type: "income",
  };
  const unrelated = {
    id: "u1",
    name: "Whole Foods",
    merchant_name: "Whole Foods",
    amount: 42,
    date: "2026-11-11",
    transaction_type: "expense",
  };
  const ignored = {
    id: "i1",
    name: "Amazon Refund",
    merchant_name: "Amazon",
    amount: -89.99,
    date: "2026-11-12",
    transaction_type: "income",
    is_ignored: true,
  };

  assert.deepEqual(classifyRefundPair(refund, purchase), { original: purchase, refund });

  const ranked = rankRefundCandidates(purchase, [unrelated, ignored, refund]);
  assert.deepEqual(ranked.map((r) => r.id), ["r1", "u1"]);
});
