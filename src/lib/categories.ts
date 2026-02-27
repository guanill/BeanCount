/**
 * Category definitions.
 * Plaid's personal_finance_category.primary values are mapped here.
 * A keyword fallback is used for manual transactions.
 */

export type TransactionType = "income" | "expense" | "transfer";

export interface CategoryMeta {
  label: string;
  color: string;       // hex or tailwind arbitrary
  emoji: string;
  type: TransactionType;
}

export const CATEGORIES: Record<string, CategoryMeta> = {
  income:              { label: "Income",          color: "#00c896", emoji: "💰", type: "income"   },
  transfer_in:         { label: "Transfer In",     color: "#4ecdc4", emoji: "↙️", type: "transfer" },
  transfer_out:        { label: "Transfer Out",    color: "#f9ca24", emoji: "↗️", type: "transfer" },
  food_and_drink:      { label: "Food & Drink",    color: "#ff7675", emoji: "🍔", type: "expense"  },
  shopping:            { label: "Shopping",        color: "#a29bfe", emoji: "🛍️", type: "expense"  },
  transportation:      { label: "Transport",       color: "#74b9ff", emoji: "🚗", type: "expense"  },
  entertainment:       { label: "Entertainment",   color: "#fd79a8", emoji: "🎬", type: "expense"  },
  rent_and_utilities:  { label: "Utilities",       color: "#0984e3", emoji: "🏠", type: "expense"  },
  medical:             { label: "Health",          color: "#e17055", emoji: "🏥", type: "expense"  },
  personal_care:       { label: "Personal Care",   color: "#fab1a0", emoji: "💅", type: "expense"  },
  travel:              { label: "Travel",          color: "#fdcb6e", emoji: "✈️", type: "expense"  },
  loan_payments:       { label: "Loan Payments",   color: "#d63031", emoji: "💳", type: "expense"  },
  home_improvement:    { label: "Home",            color: "#55efc4", emoji: "🔧", type: "expense"  },
  general_services:    { label: "Services",        color: "#636e72", emoji: "🔨", type: "expense"  },
  government:          { label: "Government",      color: "#b2bec3", emoji: "🏛️", type: "expense"  },
  bank_fees:           { label: "Bank Fees",       color: "#dfe6e9", emoji: "🏦", type: "expense"  },
  other:               { label: "Other",           color: "#747d8c", emoji: "📦", type: "expense"  },
};

/** Map Plaid's primary category string → our category key */
export function plaidCategoryToKey(plaidPrimary: string): string {
  const map: Record<string, string> = {
    INCOME:                    "income",
    TRANSFER_IN:               "transfer_in",
    TRANSFER_OUT:              "transfer_out",
    FOOD_AND_DRINK:            "food_and_drink",
    GENERAL_MERCHANDISE:       "shopping",
    TRANSPORTATION:            "transportation",
    ENTERTAINMENT:             "entertainment",
    RENT_AND_UTILITIES:        "rent_and_utilities",
    MEDICAL:                   "medical",
    PERSONAL_CARE:             "personal_care",
    TRAVEL:                    "travel",
    LOAN_PAYMENTS:             "loan_payments",
    HOME_IMPROVEMENT:          "home_improvement",
    GENERAL_SERVICES:          "general_services",
    GOVERNMENT_AND_NON_PROFIT: "government",
    BANK_FEES:                 "bank_fees",
  };
  return map[plaidPrimary] ?? "other";
}

/** Keyword-based fallback for manual transactions */
const KEYWORD_RULES: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /salary|payroll|direct.?dep|zelle.?from|venmo.?from|paycheck/i, category: "income"           },
  { pattern: /uber.?eats|doordash|grubhub|mcdonald|burger|pizza|starbucks|chipotle|restaurant|cafe|taco/i, category: "food_and_drink" },
  { pattern: /amazon|walmart|target|costco|ebay|etsy|best.?buy|shopping|store/i,                           category: "shopping"        },
  { pattern: /uber|lyft|gas|shell|bp|chevron|exxon|parking|toll|transit|metro|subway|bart/i,               category: "transportation"  },
  { pattern: /netflix|hulu|spotify|disney|youtube|steam|playstation|xbox|movie|theater/i,                  category: "entertainment"   },
  { pattern: /rent|mortgage|electric|water|internet|comcast|att|verizon|tmobile|utility/i,                 category: "rent_and_utilities" },
  { pattern: /hospital|doctor|pharmacy|cvs|walgreens|dental|medical|health/i,                              category: "medical"         },
  { pattern: /salon|spa|haircut|gym|fitness|barber/i,                                                       category: "personal_care"   },
  { pattern: /airline|airbnb|hotel|marriott|hilton|flight|booking|expedia|vrbo/i,                           category: "travel"          },
  { pattern: /student.?loan|car.?loan|mortgage.?payment|loan.?payment/i,                                    category: "loan_payments"   },
  { pattern: /home.?depot|lowes|ikea|furniture/i,                                                            category: "home_improvement"},
  { pattern: /transfer|wire|payment/i,                                                                       category: "transfer_out"    },
];

export function guessCategory(name: string, amount: number): { category: string; type: TransactionType } {
  // Positive amount in Plaid = debit (money leaving). Negative = credit (money incoming).
  if (amount < 0) return { category: "income", type: "income" };

  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(name)) {
      const meta = CATEGORIES[rule.category];
      return { category: rule.category, type: meta?.type ?? "expense" };
    }
  }
  return { category: "other", type: "expense" };
}

export function getCategoryMeta(key: string): CategoryMeta {
  return CATEGORIES[key] ?? CATEGORIES.other;
}
