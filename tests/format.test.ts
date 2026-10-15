import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCurrency, formatDate } from "../src/lib/format.ts";

test("formats date-only values without a timezone shift", () => {
  assert.equal(formatDate("2026-01-05"), "Jan 5, 2026");
});

test("formats dates with the default USD currency", () => {
  assert.equal(formatCurrency(1234.5), "$1,234.50");
});

test("formats amounts using the requested currency code", () => {
  assert.equal(formatCurrency(1234.5, "EUR"), "€1,234.50");
});
