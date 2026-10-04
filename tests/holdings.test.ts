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

test("values satoshi-precision crypto amounts", () => {
  const prices = { BTC: { price: 85319.405, updatedAt: fresh }, DOGE: { price: 0.095475, updatedAt: fresh } };
  const v = valueHoldings(
    [{ ticker: "BTC", shares: 0.12345678 }, { ticker: "BTC", shares: 0.00000001 }, { ticker: "DOGE", shares: 1_250_000 }],
    prices,
    now
  );
  // Full 8 dp has to reach the arithmetic intact. What guarantees the *stored*
  // amount keeps those digits is the numeric(28,8) column — at 6 dp Postgres
  // rounded 0.12345678 to 0.123457 and one satoshi to 0, which then failed
  // CHECK (shares > 0). See 20261004000000_widen_holdings_shares.sql.
  assert.ok(Math.abs(v[0].value! - 10533.2590128159) < 1e-9);
  assert.ok(v[1].value! > 0, "one satoshi must not round away to zero");
  assert.ok(Math.abs(v[2].value! - 119343.75) < 1e-9);
  // Large unit counts (meme coins) must not lose the fractional price either.
  assert.equal(v[2].holding.ticker, "DOGE");
});
