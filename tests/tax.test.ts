import assert from "node:assert/strict";
import test from "node:test";
import {
  computeAnnualTax,
  computeMonthlyNet,
  netOfSupplemental,
  SUPPLEMENTAL_TAX_RATE,
  taxTableFor,
} from "../src/lib/tax.ts";

test("computeAnnualTax returns null for zero or negative income", () => {
  assert.equal(computeAnnualTax(0, "single", 2026), null);
  assert.equal(computeAnnualTax(-5000, "single", 2026), null);
});

test("computeAnnualTax computes 2026 single federal, FICA, and WA Cares accurately", () => {
  const res = computeAnnualTax(100_000, "single", 2026);
  assert.ok(res);
  // Taxable = 100,000 - 16,100 = 83,900
  assert.equal(res.taxable, 83_900);
  // 12,400 * 0.10 + (50,400 - 12,400) * 0.12 + (83,900 - 50,400) * 0.22
  const expectedFed = 12_400 * 0.1 + 38_000 * 0.12 + 33_500 * 0.22;
  assert.ok(Math.abs(res.federal - expectedFed) < 1e-6);
  assert.equal(res.marginal, 0.22);
  assert.ok(Math.abs(res.ss - 100_000 * 0.062) < 1e-6);
  assert.ok(Math.abs(res.medicare - 100_000 * 0.0145) < 1e-6);
  assert.ok(Math.abs(res.waCares - 100_000 * 0.0058) < 1e-6);
  assert.ok(Math.abs(res.net - (100_000 - res.total)) < 1e-6);
});

test("computeAnnualTax caps Social Security at wage base and applies Additional Medicare", () => {
  const gross = 250_000;
  const res = computeAnnualTax(gross, "single", 2026);
  assert.ok(res);
  assert.ok(Math.abs(res.ss - 184_500 * 0.062) < 1e-6);
  const expectedMedicare = 250_000 * 0.0145 + (250_000 - 200_000) * 0.009;
  assert.ok(Math.abs(res.medicare - expectedMedicare) < 1e-6);
});

test("computeAnnualTax separates non-wage income from payroll taxes", () => {
  const res = computeAnnualTax(150_000, "mfj", 2026, 100_000);
  assert.ok(res);
  assert.equal(res.taxable, 150_000 - 32_200);
  assert.ok(Math.abs(res.ss - 100_000 * 0.062) < 1e-6);
  assert.ok(Math.abs(res.waCares - 100_000 * 0.0058) < 1e-6);
});

test("taxTableFor falls back to closest earlier year or earliest available year", () => {
  assert.equal(taxTableFor(2030), taxTableFor(2027));
  assert.equal(taxTableFor(2020), taxTableFor(2025));
});

test("computeMonthlyNet and netOfSupplemental match annual/supplemental formulas", () => {
  const annual = computeAnnualTax(120_000, "single", 2026);
  assert.ok(annual);
  assert.ok(Math.abs(computeMonthlyNet(120_000, "single", 2026) - annual.net / 12) < 1e-6);
  assert.equal(computeMonthlyNet(0, "single", 2026), 0);
  assert.ok(Math.abs(netOfSupplemental(10_000) - 10_000 * (1 - SUPPLEMENTAL_TAX_RATE)) < 1e-6);
  assert.equal(netOfSupplemental(-500), -500);
});
