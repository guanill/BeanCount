import { test } from "node:test";
import assert from "node:assert/strict";
import { detectCsvImportSource } from "../src/lib/csv-source-detection.ts";

const sources = [
  { value: "card:visa", name: "Visa • 1234" },
  { value: "card:amex", name: "Amex • 5678" },
];

test("detects a source by its last four digits in the file name", () => {
  assert.equal(detectCsvImportSource("transactions_1234.csv", "Date,Description,Amount\n", sources), "card:visa");
});

test("detects a source by an explicit card-number CSV column", () => {
  const csv = "Date,Description,Amount,Card Number\n2026-01-02,Coffee,4.50,**** 5678";
  assert.equal(detectCsvImportSource("transactions.csv", csv, sources), "card:amex");
});

test("detects a source by its full name in the file name", () => {
  assert.equal(detectCsvImportSource("Visa_1234_activity.csv", "Date,Description,Amount\n", sources), "card:visa");
});

test("leaves unmatched and ambiguous sources for manual selection", () => {
  assert.equal(detectCsvImportSource("transactions.csv", "Date,Description,Amount\n", sources), null);
  assert.equal(
    detectCsvImportSource(
      "transactions.csv",
      "Date,Description,Amount,Card Number\n2026-01-02,Coffee,4.50,1234",
      [...sources, { value: "account:checking", name: "Checking • 1234" }],
    ),
    null,
  );
});
