import assert from "node:assert/strict";
import test from "node:test";
import {
  attachRefundTag,
  canDeleteSplitOriginal,
  defaultSplitNames,
  filterVisibleTransactions,
  isSplitOriginal,
  parseRefundLink,
  partitionVisibleTransactions,
  rankRefundCandidates,
  removeRefundTag,
  stripRefundTag,
  sumActiveAmount,
  sumActiveExpenses,
} from "../src/lib/transactions.ts";

test("sumActiveAmount excludes ignored transactions from category totals", () => {
  const txs = [
    { amount: 42.5, is_ignored: false },
    { amount: 100, is_ignored: true },
    { amount: -17.5, is_ignored: false },
  ];

  assert.equal(sumActiveAmount(txs), 60);
});

test("sumActiveExpenses excludes ignored transactions and non-expense rows", () => {
  const txs = [
    { amount: 50, transaction_type: "expense", is_ignored: false },
    { amount: 80, transaction_type: "expense", is_ignored: true },
    { amount: -200, transaction_type: "income", is_ignored: false },
    { amount: 30, transaction_type: "transfer", is_ignored: false },
  ];

  assert.equal(sumActiveExpenses(txs), 50);
});

test("isSplitOriginal and filterVisibleTransactions hide [split] ignored parents but keep normal ignored rows", () => {
  const splitParent = { id: "1", is_ignored: true, notes: "[split]" };
  const splitParentWithNote = { id: "2", is_ignored: true, notes: "Dinner [split]" };
  const normalIgnored = { id: "3", is_ignored: true, notes: "Duplicate charge" };
  const active = { id: "4", is_ignored: false, notes: null };

  assert.equal(isSplitOriginal(splitParent), true);
  assert.equal(isSplitOriginal(splitParentWithNote), true);
  assert.equal(isSplitOriginal(normalIgnored), false);
  assert.equal(isSplitOriginal(active), false);

  const visible = filterVisibleTransactions([
    splitParent,
    splitParentWithNote,
    normalIgnored,
    active,
  ]);
  assert.deepEqual(
    visible.map((t) => t.id),
    ["3", "4"],
  );

  const partitioned = partitionVisibleTransactions([
    splitParent,
    splitParentWithNote,
    normalIgnored,
    active,
  ]);
  assert.deepEqual(
    partitioned.active.map((t) => t.id),
    ["4"],
  );
  assert.deepEqual(
    partitioned.ignored.map((t) => t.id),
    ["3"],
  );
});

test("defaultSplitNames appends (your part) and (other part)", () => {
  assert.deepEqual(defaultSplitNames("Chipotle"), {
    yourPart: "Chipotle (your part)",
    otherPart: "Chipotle (other part)",
  });
  assert.deepEqual(defaultSplitNames("   "), {
    yourPart: "Transaction (your part)",
    otherPart: "Transaction (other part)",
  });
});

test("canDeleteSplitOriginal only deletes purely manual transactions", () => {
  assert.equal(
    canDeleteSplitOriginal({
      is_manual: true,
      import_fingerprint: null,
      plaid_transaction_id: null,
      teller_transaction_id: null,
    }),
    true,
  );
  assert.equal(
    canDeleteSplitOriginal({
      is_manual: false,
      import_fingerprint: "card:1:2026-04-01:50:chipotle:0",
      plaid_transaction_id: null,
      teller_transaction_id: null,
    }),
    false,
  );
  assert.equal(
    canDeleteSplitOriginal({
      is_manual: true,
      import_fingerprint: null,
      plaid_transaction_id: "plaid_123",
      teller_transaction_id: null,
    }),
    false,
  );
});

test("refund tag helpers attach, parse, strip, and remove cleanly without losing user notes", () => {
  const tagged = attachRefundTag("Order #1234", {
    role: "original",
    partnerId: "tx-refund-1",
    partnerDate: "2026-11-18",
    partnerName: "Amazon: Refund [Prime]",
  });

  const parsed = parseRefundLink(tagged);
  assert.deepEqual(parsed, {
    role: "original",
    partnerId: "tx-refund-1",
    partnerDate: "2026-11-18",
    partnerName: "Amazon Refund [Prime",
  });
  assert.equal(stripRefundTag(tagged), "Order #1234");
  assert.equal(removeRefundTag(tagged), "Order #1234");
  assert.equal(
    removeRefundTag(
      attachRefundTag(null, {
        role: "refund",
        partnerId: "tx-orig-1",
        partnerDate: "2026-11-14",
        partnerName: "Amazon",
      }),
    ),
    null,
  );
});

test("rankRefundCandidates prioritizes exact opposite-type merchant matches and excludes ignored rows", () => {
  const purchase = {
    id: "orig",
    name: "Amazon Marketplace",
    merchant_name: "Amazon",
    amount: 49.99,
    date: "2026-11-10",
    transaction_type: "expense",
    is_ignored: false,
    notes: null,
  };

  const exactRefund = {
    id: "ref-exact",
    name: "Amazon Refund",
    merchant_name: "Amazon",
    amount: -49.99,
    date: "2026-11-14",
    transaction_type: "income",
    is_ignored: false,
    notes: null,
  };
  const partialRefund = {
    id: "ref-partial",
    name: "Amazon Partial",
    merchant_name: "Amazon",
    amount: -20,
    date: "2026-11-15",
    transaction_type: "income",
    is_ignored: false,
    notes: null,
  };
  const unrelated = {
    id: "other",
    name: "Starbucks",
    merchant_name: "Starbucks",
    amount: 6.5,
    date: "2026-11-11",
    transaction_type: "expense",
    is_ignored: false,
    notes: null,
  };
  const alreadyIgnored = {
    id: "ign",
    name: "Amazon",
    merchant_name: "Amazon",
    amount: -49.99,
    date: "2026-11-12",
    transaction_type: "income",
    is_ignored: true,
    notes: null,
  };

  const ranked = rankRefundCandidates(purchase, [
    purchase,
    unrelated,
    alreadyIgnored,
    partialRefund,
    exactRefund,
  ]);

  assert.deepEqual(
    ranked.map((t) => t.id),
    ["ref-exact", "ref-partial", "other"],
  );
});
