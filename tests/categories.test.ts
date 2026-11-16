import { test } from "node:test";
import assert from "node:assert/strict";
import { applyMerchantCategoryRule, guessCategory, normalizeMerchantKey } from "../src/lib/categories.ts";
import { classifyPlaidFallback, guessCategory as guessEdgeCategory } from "../supabase/functions/_shared/categories.ts";

test("normalizes merchant names consistently", () => {
  assert.equal(normalizeMerchantKey("  ACME, Inc. #123  "), "acme inc 123");
});

test("does not create a key for blank or oversized merchant names", () => {
  assert.equal(normalizeMerchantKey("   "), null);
  assert.equal(normalizeMerchantKey("x".repeat(501)), null);
});

test("a saved merchant category takes priority over provider categorization", () => {
  assert.deepEqual(
    applyMerchantCategoryRule(
      { category: "shopping", type: "expense" },
      { category: "groceries", transaction_type: "expense" },
    ),
    { category: "groceries", type: "expense" },
  );
});

test("provider or keyword categorization remains the fallback without a saved rule", () => {
  const fallback = { category: "food_and_drink", type: "expense" } as const;
  assert.deepEqual(applyMerchantCategoryRule(fallback), fallback);
});

test("covers additional common merchants across existing categories", () => {
  const examples = [
    ["H Mart", 42, "groceries"],
    ["Dutch Bros", 8, "food_and_drink"],
    ["EVgo charging", 19, "transportation"],
    ["iCloud storage", 3, "subscriptions"],
    ["Disneyland tickets", 150, "entertainment"],
    ["Kaiser Permanente", 35, "medical"],
    ["Rover", 28, "pets"],
    ["edX course", 40, "education"],
    ["Affirm payment", 60, "loan_payments"],
    ["T-Mobile autopay", 75, "rent_and_utilities"],
    ["TEMU order", 16, "shopping"],
  ] as const;

  for (const [description, amount, expectedCategory] of examples) {
    assert.equal(guessCategory(description, amount).category, expectedCategory, description);
    assert.equal(guessEdgeCategory(description, amount).category, expectedCategory, description);
  }
});

test("classifies incoming and outgoing transfers by amount direction", () => {
  assert.deepEqual(guessCategory("Zelle payment", 25), {
    category: "transfer_out",
    type: "transfer",
  });
  assert.deepEqual(guessCategory("Zelle payment", -25), {
    category: "transfer_in",
    type: "transfer",
  });
  assert.deepEqual(guessEdgeCategory("Zelle payment", -25), {
    category: "transfer_in",
    type: "transfer",
  });
  assert.equal(guessCategory("Wire transfer fee", 25).category, "bank_fees");
});

test("recognizes additional travel, retail, transit and billing descriptors", () => {
  const examples = [
    ["Trip.com", "travel"],
    ["Klook Travel Technology", "travel"],
    ["AIRALO", "travel"],
    ["MRT-BEM", "transportation"],
    ["TFL TRAVEL CH", "transportation"],
    ["TOYOTARENTLEASEYAMANASHI", "transportation"],
    ["SHOPEETH BANGKOK TH", "shopping"],
    ["PAYPAL *TIKTOK SHOP", "shopping"],
    ["BRICKSEEK.COM", "shopping"],
    ["TESCO STORES", "groceries"],
    ["THRIVE MARKET", "groceries"],
    ["LEMONADE INSURANCE", "rent_and_utilities"],
    ["CAPITAL ONE MEMBER FEE", "bank_fees"],
    ["Unidentified merchant", "other"],
    ["Offer:Airalo", "other"],
  ] as const;
  for (const [description, expected] of examples) {
    assert.equal(guessCategory(description, 10).category, expected, description);
    assert.equal(guessEdgeCategory(description, 10).category, expected, description);
  }
});

test("Plaid falls back to merchant descriptions for unmapped categories", () => {
  assert.deepEqual(classifyPlaidFallback("UNKNOWN", "Trip.com", 10), { category: "travel", type: "expense" });
  assert.deepEqual(classifyPlaidFallback("", "Unidentified merchant", 10), { category: "other", type: "expense" });
  assert.deepEqual(classifyPlaidFallback("GENERAL_MERCHANDISE", "Trip.com", 10), { category: "shopping", type: "expense" });
});
