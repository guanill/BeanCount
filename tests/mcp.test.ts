import assert from "node:assert/strict";
import test from "node:test";
import {
  appendSplitTag,
  applyLoanPaidStatus,
  attachRefundTag,
  buildImportFingerprint,
  canDeleteSplitOriginal,
  classifyRefundPair,
  constantTimeEqual,
  defaultSplitNames,
  defaultTransactionTypeForCategory,
  deletePlannerCollectionItem,
  isSplitOriginal,
  normalizeMerchantKey,
  parseRefundLink,
  rankRefundCandidates,
  removeRefundTag,
  resolveNamedEntity,
  summarizeTransactions,
  toSignedAmount,
  upsertPlannerCollectionItem,
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

test("upsertPlannerCollectionItem and deletePlannerCollectionItem manage planner arrays cleanly", () => {
  const created = upsertPlannerCollectionItem(
    [],
    { label: "Rent", amount: 2200, category: "housing" },
    () => "rc-1"
  );
  assert.equal(created.action, "created");
  assert.deepEqual(created.saved, { id: "rc-1", label: "Rent", amount: 2200, category: "housing" });

  const updated = upsertPlannerCollectionItem(created.items, { id: "rc-1", amount: 2350 });
  assert.equal(updated.action, "updated");
  assert.deepEqual(updated.saved, { id: "rc-1", label: "Rent", amount: 2350, category: "housing" });

  const deleted = deletePlannerCollectionItem(updated.items, "rc-1");
  assert.equal(deleted.deleted?.id, "rc-1");
  assert.deepEqual(deleted.items, []);

  const missing = deletePlannerCollectionItem(updated.items, "does-not-exist");
  assert.equal(missing.deleted, null);
  assert.equal(missing.items.length, 1);
});

test("applyLoanPaidStatus handles marking paid, marking unpaid, and month rollover", () => {
  const paid = applyLoanPaidStatus({
    loanId: "loan-1",
    paid: true,
    month: "2026-11",
    currentPaidLoanIds: ["loan-old"],
    currentPaidLoanMonth: "2026-10",
    currentUnpaidOverrides: { "loan-1": "2026-11" },
  });
  assert.deepEqual(paid.paid_loan_ids, ["loan-1"]);
  assert.equal(paid.paid_loan_month, "2026-11");
  assert.deepEqual(paid.loanUnpaidMonthOverrides, {});

  const unpaid = applyLoanPaidStatus({
    loanId: "loan-1",
    paid: false,
    month: "2026-11",
    currentPaidLoanIds: ["loan-1", "loan-2"],
    currentPaidLoanMonth: "2026-11",
    currentUnpaidOverrides: {},
  });
  assert.deepEqual(unpaid.paid_loan_ids, ["loan-2"]);
  assert.deepEqual(unpaid.loanUnpaidMonthOverrides, { "loan-1": "2026-11" });
});

test("buildImportFingerprint generates deterministic dedupe keys", () => {
  const fp1 = buildImportFingerprint({
    sourceKey: "acc-1",
    date: "2026-11-25",
    amount: 42.5,
    name: "Trader Joe's #102",
    occurrence: 1,
  });
  const fp2 = buildImportFingerprint({
    sourceKey: "acc-1",
    date: "2026-11-25",
    amount: 42.5,
    name: "Trader Joe's #102",
    occurrence: 2,
  });
  assert.equal(fp1, "mcp:acc-1:2026-11-25:42.50:trader joe s 102:1");
  assert.notEqual(fp1, fp2);
});
