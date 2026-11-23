import assert from "node:assert/strict";
import test from "node:test";
import {
  canDeleteSplitOriginal,
  defaultSplitNames,
  filterVisibleTransactions,
  isSplitOriginal,
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
