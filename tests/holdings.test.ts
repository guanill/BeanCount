import { test } from "node:test";
import assert from "node:assert/strict";
import { valueHoldings, totalValue, isStale, STALE_AFTER_MS } from "../src/lib/holdings.ts";

const now = Date.parse("2026-01-01T12:00:00Z");
const fresh = new Date(now - 1000).toISOString();
const old = new Date(now - STALE_AFTER_MS - 1000).toISOString();

test("values holdings as shares × price", () => {
  const v = valueHoldings(
    [{ ticker: "nvda", shares: 2.5 }, { ticker: "AAPL", shares: 10 }],
    { NVDA: { price: 100, updatedAt: fresh }, AAPL: { price: 200, updatedAt: fresh } },
    now
  );
  assert.equal(v[0].value, 250);
  assert.equal(v[1].value, 2000);
  assert.equal(totalValue(v), 2250);
  assert.equal(v[0].stale, false);
});

test("missing quotes yield null value and are excluded from total", () => {
  const v = valueHoldings([{ ticker: "XXXX", shares: 5 }, { ticker: "AAPL", shares: 1 }],
    { AAPL: { price: 50, updatedAt: fresh } }, now);
  assert.equal(v[0].value, null);
  assert.equal(v[0].stale, true);
  assert.equal(totalValue(v), 50);
});

test("old quotes are flagged stale but still valued", () => {
  const v = valueHoldings([{ ticker: "AAPL", shares: 2 }], { AAPL: { price: 10, updatedAt: old } }, now);
  assert.equal(v[0].value, 20);
  assert.equal(v[0].stale, true);
  assert.equal(isStale("garbage", now), true);
});
