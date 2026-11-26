// BeanCount Remote MCP Server (Streamable HTTP, JSON-RPC 2.0)
// Deploy with: supabase functions deploy beancount-mcp --no-verify-jwt
//
// Full CRUD across accounts, credit_cards, debts_owed, liabilities, loans,
// stock_holdings, transactions, and planner_configs — strictly scoped to user_id.
// integration_tokens (Plaid/Teller secrets) is never exposed.

import { getSupabaseAdmin, getSupabaseClient } from "../_shared/supabase.ts";
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
  PLANNER_COLLECTIONS,
  rankRefundCandidates,
  removeRefundTag,
  resolveNamedEntity,
  summarizeTransactions,
  toSignedAmount,
  upsertPlannerCollectionItem,
  VALID_CATEGORIES,
  VALID_TRANSACTION_TYPES,
} from "./helpers.ts";

const MCP_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, mcp-session-id, accept",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const JSON_HEADERS = {
  ...MCP_CORS_HEADERS,
  "Content-Type": "application/json",
};

const SERVER_INFO = {
  name: "beancount-mcp",
  version: "2.2.0",
};

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true };
const WRITE_IDEMPOTENT = { readOnlyHint: false, destructiveHint: false, idempotentHint: true };
const WRITE_CREATE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false };
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true };

const TOOLS = [
  // ── Overview & Reads ───────────────────────────────────────────────────────
  {
    name: "get_net_worth",
    description:
      "Get current BeanCount net worth summary (assets, credit card debt, liabilities, loans, debts owed, points value) and recent net worth snapshots.",
    inputSchema: {
      type: "object",
      properties: {
        history_days: { type: "integer", minimum: 1, maximum: 365, description: "Default 30." },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "list_accounts",
    description: "List bank, cash, stock, and crypto accounts plus credit cards with all fields.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["bank", "cash", "stock", "crypto"] },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "list_debts_and_liabilities",
    description: "List all debts owed to you (pending/partial/paid) and all liabilities.",
    inputSchema: {
      type: "object",
      properties: {
        include_paid_debts: { type: "boolean", description: "Include paid debts_owed (default true)." },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "list_holdings_and_loans",
    description: "List all stock/crypto holdings and all loans with every field.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: READ_ONLY,
  },
  {
    name: "search_transactions",
    description:
      "Search transactions by date range, keyword, category, transaction type, account/card, or ignored status. Hides [split] originals by default and surfaces parsed refund_link metadata.",
    inputSchema: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "YYYY-MM-DD (inclusive)." },
        end_date: { type: "string", description: "YYYY-MM-DD (inclusive)." },
        category: { type: "string" },
        query: { type: "string", description: "Case-insensitive keyword in name or merchant_name." },
        transaction_type: { type: "string", enum: ["income", "expense", "transfer"] },
        account_id: { type: "string", description: "Optional bank/cash/stock/crypto account ID filter." },
        credit_card_id: { type: "string", description: "Optional credit card ID filter." },
        is_ignored: {
          type: "boolean",
          description: "Filter by ignored status (true = ignored only, false = active only, omit for both).",
        },
        include_split_originals: {
          type: "boolean",
          description: "Include hidden [split]-ignored parent rows (default false).",
        },
        limit: { type: "integer", minimum: 1, maximum: 200, description: "Default 50." },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "get_spending_summary",
    description: "Summarize income, expenses, net cashflow, and spending by category for a date range (defaults to current month).",
    inputSchema: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "YYYY-MM-DD." },
        end_date: { type: "string", description: "YYYY-MM-DD." },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "get_planner_config",
    description: "Get the user's Planner & Tax configuration (tax_filing_status, paid loans, recurring bills, salary schedules).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: READ_ONLY,
  },
  {
    name: "save_net_worth_snapshot",
    description:
      "Save or update a daily net_worth_snapshots entry for a given date (defaults to today). Omit numeric fields to auto-compute them from current accounts, credit cards, debts owed, and liabilities.",
    inputSchema: {
      type: "object",
      properties: {
        snapshot_date: { type: "string", description: "YYYY-MM-DD (defaults to today UTC)." },
        net_worth: { type: "number", description: "Optional override; auto-computed if omitted." },
        assets_total: { type: "number", description: "Optional override; auto-computed if omitted." },
        stock_total: { type: "number", description: "Optional override; auto-computed if omitted." },
        crypto_total: { type: "number", description: "Optional override; auto-computed if omitted." },
      },
      additionalProperties: false,
    },
    annotations: WRITE_IDEMPOTENT,
  },
  {
    name: "delete_net_worth_snapshot",
    description: "Delete a net worth snapshot by snapshot_id or snapshot_date (YYYY-MM-DD).",
    inputSchema: {
      type: "object",
      properties: {
        snapshot_id: { type: "string" },
        snapshot_date: { type: "string", description: "YYYY-MM-DD." },
      },
      additionalProperties: false,
    },
    annotations: DESTRUCTIVE,
  },
  {
    name: "list_merchant_category_rules",
    description: "List all saved merchant_category_rules that auto-categorize future transactions for specific merchants.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: READ_ONLY,
  },
  {
    name: "upsert_merchant_category_rule",
    description:
      "Create or update a merchant category rule so future imports/transactions from that merchant get the chosen category and transaction_type. Optionally retroactively apply to existing transactions.",
    inputSchema: {
      type: "object",
      properties: {
        merchant: { type: "string", description: "Merchant name or normalized merchant_key." },
        category: { type: "string", description: "Valid BeanCount category slug." },
        transaction_type: { type: "string", enum: ["expense", "income", "transfer"] },
        apply_to_existing: {
          type: "boolean",
          description: "If true, also update existing non-ignored transactions matching this merchant (default false).",
        },
      },
      required: ["merchant", "category"],
      additionalProperties: false,
    },
    annotations: WRITE_IDEMPOTENT,
  },
  {
    name: "delete_merchant_category_rule",
    description: "Delete a saved merchant category rule by merchant name or normalized merchant_key.",
    inputSchema: {
      type: "object",
      properties: {
        merchant: { type: "string", description: "Merchant name or normalized merchant_key." },
      },
      required: ["merchant"],
      additionalProperties: false,
    },
    annotations: DESTRUCTIVE,
  },

  // ── Accounts CRUD ──────────────────────────────────────────────────────────
  {
    name: "create_account",
    description: "Create a new bank, cash, stock, or crypto account.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Account display name." },
        type: { type: "string", enum: ["bank", "cash", "stock", "crypto"] },
        balance: { type: "number", description: "Starting balance (default 0)." },
        currency: { type: "string", description: "Currency code (default 'USD')." },
        icon: { type: "string" },
        color: { type: "string" },
      },
      required: ["name", "type"],
      additionalProperties: false,
    },
    annotations: WRITE_CREATE,
  },
  {
    name: "update_account",
    description: "Update any field on an account (rename, change type, balance, currency, icon, color). Identify by account_id or account_name.",
    inputSchema: {
      type: "object",
      properties: {
        account_id: { type: "string" },
        account_name: { type: "string", description: "Current account name to match." },
        name: { type: "string", description: "New account name." },
        type: { type: "string", enum: ["bank", "cash", "stock", "crypto"] },
        balance: { type: "number" },
        currency: { type: "string" },
        icon: { type: "string" },
        color: { type: "string" },
      },
      additionalProperties: false,
    },
    annotations: WRITE_IDEMPOTENT,
  },
  {
    name: "update_account_balance",
    description: "Shorthand to update an account's balance by account_id or account_name.",
    inputSchema: {
      type: "object",
      properties: {
        account_id: { type: "string" },
        account_name: { type: "string" },
        balance: { type: "number" },
      },
      required: ["balance"],
      additionalProperties: false,
    },
    annotations: WRITE_IDEMPOTENT,
  },
  {
    name: "delete_account",
    description: "Delete an account (preserves historical transactions with the account's name). Identify by account_id or account_name.",
    inputSchema: {
      type: "object",
      properties: {
        account_id: { type: "string" },
        account_name: { type: "string" },
      },
      additionalProperties: false,
    },
    annotations: DESTRUCTIVE,
  },

  // ── Credit Cards CRUD ──────────────────────────────────────────────────────
  {
    name: "create_credit_card",
    description: "Add a new credit card.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        balance_owed: { type: "number", description: "Default 0." },
        credit_limit: { type: "number", description: "Default 0." },
        points_balance: { type: "number", description: "Default 0." },
        points_value_cents: { type: "number", description: "Cents per point (default 1)." },
        due_date: { type: "string", description: "YYYY-MM-DD." },
        min_payment: { type: "number", description: "Default 0." },
        color: { type: "string" },
      },
      required: ["name"],
      additionalProperties: false,
    },
    annotations: WRITE_CREATE,
  },
  {
    name: "update_credit_card",
    description: "Update any field on a credit card (rename, balance_owed, credit_limit, points_balance, points_value_cents, due_date, min_payment, color).",
    inputSchema: {
      type: "object",
      properties: {
        card_id: { type: "string" },
        card_name: { type: "string", description: "Current card name to match." },
        name: { type: "string", description: "New card name." },
        balance_owed: { type: "number" },
        credit_limit: { type: "number" },
        points_balance: { type: "number" },
        points_value_cents: { type: "number" },
        due_date: { type: "string", description: "YYYY-MM-DD or empty string to clear." },
        min_payment: { type: "number" },
        color: { type: "string" },
      },
      additionalProperties: false,
    },
    annotations: WRITE_IDEMPOTENT,
  },
  {
    name: "update_credit_card_balance",
    description: "Shorthand to update a credit card's balance_owed and/or points_balance.",
    inputSchema: {
      type: "object",
      properties: {
        card_id: { type: "string" },
        card_name: { type: "string" },
        balance_owed: { type: "number" },
        points_balance: { type: "number" },
      },
      additionalProperties: false,
    },
    annotations: WRITE_IDEMPOTENT,
  },
  {
    name: "delete_credit_card",
    description: "Delete a credit card (preserves historical transactions with the card's name).",
    inputSchema: {
      type: "object",
      properties: {
        card_id: { type: "string" },
        card_name: { type: "string" },
      },
      additionalProperties: false,
    },
    annotations: DESTRUCTIVE,
  },

  // ── Debts Owed (Pending / Partial / Paid) CRUD ─────────────────────────────
  {
    name: "create_debt_owed",
    description: "Add money someone owes you (pending, partial, or paid).",
    inputSchema: {
      type: "object",
      properties: {
        person_name: { type: "string", description: "Who owes you." },
        amount: { type: "number" },
        reason: { type: "string" },
        due_date: { type: "string", description: "YYYY-MM-DD." },
        status: { type: "string", enum: ["pending", "partial", "paid"], description: "Default 'pending'." },
      },
      required: ["person_name", "amount"],
      additionalProperties: false,
    },
    annotations: WRITE_CREATE,
  },
  {
    name: "update_debt_owed",
    description: "Update a debt owed entry (person_name, amount, reason, due_date, or status: pending/partial/paid).",
    inputSchema: {
      type: "object",
      properties: {
        debt_id: { type: "string" },
        match_person_name: { type: "string", description: "Current person_name to match if debt_id is omitted." },
        person_name: { type: "string", description: "New person_name." },
        amount: { type: "number" },
        reason: { type: "string" },
        due_date: { type: "string", description: "YYYY-MM-DD or empty string to clear." },
        status: { type: "string", enum: ["pending", "partial", "paid"] },
      },
      additionalProperties: false,
    },
    annotations: WRITE_IDEMPOTENT,
  },
  {
    name: "delete_debt_owed",
    description: "Delete a debt owed entry by debt_id or match_person_name.",
    inputSchema: {
      type: "object",
      properties: {
        debt_id: { type: "string" },
        match_person_name: { type: "string" },
      },
      additionalProperties: false,
    },
    annotations: DESTRUCTIVE,
  },

  // ── Liabilities CRUD ───────────────────────────────────────────────────────
  {
    name: "create_liability",
    description: "Add a liability (money you owe, e.g. medical bill, family loan, tax owed).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        amount: { type: "number" },
        category: { type: "string", description: "Default 'other'." },
        notes: { type: "string" },
        due_date: { type: "string", description: "YYYY-MM-DD." },
      },
      required: ["name", "amount"],
      additionalProperties: false,
    },
    annotations: WRITE_CREATE,
  },
  {
    name: "update_liability",
    description: "Update any field on a liability (name, amount, category, notes, due_date).",
    inputSchema: {
      type: "object",
      properties: {
        liability_id: { type: "string" },
        liability_name: { type: "string", description: "Current liability name to match." },
        name: { type: "string", description: "New liability name." },
        amount: { type: "number" },
        category: { type: "string" },
        notes: { type: "string" },
        due_date: { type: "string", description: "YYYY-MM-DD or empty string to clear." },
      },
      additionalProperties: false,
    },
    annotations: WRITE_IDEMPOTENT,
  },
  {
    name: "delete_liability",
    description: "Delete a liability by liability_id or liability_name.",
    inputSchema: {
      type: "object",
      properties: {
        liability_id: { type: "string" },
        liability_name: { type: "string" },
      },
      additionalProperties: false,
    },
    annotations: DESTRUCTIVE,
  },

  // ── Loans CRUD ─────────────────────────────────────────────────────────────
  {
    name: "create_loan",
    description: "Add a new loan (student, auto, mortgage, personal, etc.).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        type: { type: "string", description: "e.g. 'student', 'auto', 'mortgage', 'personal' (default 'personal')." },
        balance: { type: "number" },
        original_amount: { type: "number" },
        interest_rate: { type: "number", description: "APR percentage (e.g. 5.5 for 5.5%)." },
        monthly_payment: { type: "number" },
        payment_day: { type: "integer", minimum: 1, maximum: 31 },
        deferral_months: { type: "integer", minimum: 0 },
        deferral_type: { type: "string", enum: ["subsidized", "unsubsidized"] },
        notes: { type: "string" },
      },
      required: ["name", "balance"],
      additionalProperties: false,
    },
    annotations: WRITE_CREATE,
  },
  {
    name: "update_loan",
    description: "Update any field on a loan (name, type, balance, original_amount, interest_rate, monthly_payment, payment_day, deferral_months, deferral_type, notes). Use clear_fields to set nullable fields back to null.",
    inputSchema: {
      type: "object",
      properties: {
        loan_id: { type: "string" },
        loan_name: { type: "string", description: "Current loan name to match." },
        name: { type: "string", description: "New loan name." },
        type: { type: "string", description: "New loan type (e.g. student, auto, personal, mortgage)." },
        balance: { type: "number" },
        original_amount: { type: "number" },
        interest_rate: { type: "number" },
        monthly_payment: { type: "number" },
        payment_day: { type: "integer", minimum: 1, maximum: 31 },
        deferral_months: { type: "integer", minimum: 0 },
        deferral_type: { type: "string", enum: ["subsidized", "unsubsidized"] },
        notes: { type: "string" },
        clear_fields: {
          type: "array",
          items: { type: "string", enum: ["original_amount", "payment_day", "notes"] },
          description: "Optional list of nullable fields to clear to null.",
        },
      },
      additionalProperties: false,
    },
    annotations: WRITE_IDEMPOTENT,
  },
  {
    name: "toggle_loan_paid",
    description: "Mark a loan as paid or unpaid for a given month (YYYY-MM, defaults to current month) in planner_configs.",
    inputSchema: {
      type: "object",
      properties: {
        loan_id: { type: "string" },
        loan_name: { type: "string" },
        paid: { type: "boolean", description: "True to mark paid, false to mark unpaid." },
        month: { type: "string", description: "YYYY-MM (defaults to current UTC month)." },
      },
      required: ["paid"],
      additionalProperties: false,
    },
    annotations: WRITE_IDEMPOTENT,
  },
  {
    name: "delete_loan",
    description: "Delete a loan by loan_id or loan_name.",
    inputSchema: {
      type: "object",
      properties: {
        loan_id: { type: "string" },
        loan_name: { type: "string" },
      },
      additionalProperties: false,
    },
    annotations: DESTRUCTIVE,
  },

  // ── Stock / Crypto Holdings CRUD ───────────────────────────────────────────
  {
    name: "upsert_holding",
    description: "Add or update a stock/crypto holding (ticker, shares, optional cost_basis) under a stock or crypto account.",
    inputSchema: {
      type: "object",
      properties: {
        account_id: { type: "string" },
        account_name: { type: "string" },
        ticker: { type: "string", description: "Uppercase ticker symbol (e.g. AAPL, VOO, BTC)." },
        shares: { type: "number", description: "Positive number of shares/units." },
        cost_basis: { type: "number", description: "Optional total cost basis paid." },
      },
      required: ["ticker", "shares"],
      additionalProperties: false,
    },
    annotations: WRITE_IDEMPOTENT,
  },
  {
    name: "update_holding",
    description: "Update an existing stock/crypto holding by holding_id (rename ticker, update shares/cost_basis, move account, or clear cost_basis).",
    inputSchema: {
      type: "object",
      properties: {
        holding_id: { type: "string" },
        account_id: { type: "string", description: "Optional new stock/crypto account ID." },
        account_name: { type: "string", description: "Optional new stock/crypto account name." },
        ticker: { type: "string", description: "New uppercase ticker symbol." },
        shares: { type: "number", description: "Positive number of shares/units." },
        cost_basis: { type: "number", description: "Total cost basis paid." },
        clear_cost_basis: { type: "boolean", description: "Set true to clear cost_basis to null." },
      },
      required: ["holding_id"],
      additionalProperties: false,
    },
    annotations: WRITE_IDEMPOTENT,
  },
  {
    name: "delete_holding",
    description: "Delete a stock/crypto holding by holding_id, or by ticker + account_name/account_id.",
    inputSchema: {
      type: "object",
      properties: {
        holding_id: { type: "string" },
        account_id: { type: "string" },
        account_name: { type: "string" },
        ticker: { type: "string" },
      },
      additionalProperties: false,
    },
    annotations: DESTRUCTIVE,
  },

  // ── Transactions CRUD ──────────────────────────────────────────────────────
  {
    name: "add_transaction",
    description:
      "Add a manual transaction (expense, income, or transfer) optionally linked to an account or credit card. Automatically applies saved merchant_category_rules if category is omitted or 'other'.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        merchant_name: { type: "string" },
        amount: { type: "number" },
        date: { type: "string", description: "YYYY-MM-DD (defaults to today)." },
        category: { type: "string", description: "Category slug (defaults to saved merchant rule or 'other')." },
        subcategory: { type: "string" },
        transaction_type: { type: "string", enum: ["expense", "income", "transfer"] },
        account_id: { type: "string" },
        account_name: { type: "string" },
        credit_card_id: { type: "string" },
        card_name: { type: "string" },
        is_ignored: { type: "boolean" },
        notes: { type: "string" },
      },
      required: ["name", "amount"],
      additionalProperties: false,
    },
    annotations: WRITE_CREATE,
  },
  {
    name: "update_transaction",
    description:
      "Update fields on an existing transaction by transaction_id (name, merchant_name, amount, date, category, subcategory, transaction_type, account_id/account_name, credit_card_id/card_name, is_ignored, notes). Automatically syncs merchant_name on rename and remembers merchant category rules when category changes.",
    inputSchema: {
      type: "object",
      properties: {
        transaction_id: { type: "string" },
        name: { type: "string" },
        merchant_name: { type: "string" },
        amount: { type: "number" },
        date: { type: "string", description: "YYYY-MM-DD." },
        category: { type: "string" },
        subcategory: { type: "string" },
        transaction_type: { type: "string", enum: ["expense", "income", "transfer"] },
        account_id: { type: "string" },
        account_name: { type: "string" },
        credit_card_id: { type: "string" },
        card_name: { type: "string" },
        clear_source: { type: "boolean", description: "Set true to unlink account_id and credit_card_id." },
        is_ignored: { type: "boolean" },
        notes: { type: "string", description: "Pass empty string to clear notes." },
        remember_merchant_category: {
          type: "boolean",
          description: "Save a merchant_category_rules override when category changes (default true).",
        },
      },
      required: ["transaction_id"],
      additionalProperties: false,
    },
    annotations: WRITE_IDEMPOTENT,
  },
  {
    name: "bulk_update_transactions",
    description:
      "Update category, transaction_type, is_ignored, notes, or linked account/card across multiple transaction_ids in one call.",
    inputSchema: {
      type: "object",
      properties: {
        transaction_ids: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 200,
        },
        category: { type: "string" },
        transaction_type: { type: "string", enum: ["expense", "income", "transfer"] },
        is_ignored: { type: "boolean" },
        notes: { type: "string" },
        account_id: { type: "string" },
        account_name: { type: "string" },
        credit_card_id: { type: "string" },
        card_name: { type: "string" },
        remember_merchant_category: {
          type: "boolean",
          description: "Save merchant_category_rules for updated merchants when category is set (default false).",
        },
      },
      required: ["transaction_ids"],
      additionalProperties: false,
    },
    annotations: WRITE_IDEMPOTENT,
  },
  {
    name: "import_transactions",
    description:
      "Bulk import transactions (like CSV import) with deduplication via import_fingerprint and automatic merchant_category_rules lookup.",
    inputSchema: {
      type: "object",
      properties: {
        account_id: { type: "string", description: "Optional default account ID for all rows." },
        account_name: { type: "string", description: "Optional default account name for all rows." },
        credit_card_id: { type: "string", description: "Optional default credit card ID for all rows." },
        card_name: { type: "string", description: "Optional default credit card name for all rows." },
        transactions: {
          type: "array",
          minItems: 1,
          maxItems: 500,
          items: {
            type: "object",
            properties: {
              date: { type: "string", description: "YYYY-MM-DD." },
              name: { type: "string" },
              merchant_name: { type: "string" },
              amount: { type: "number", description: "Positive amount; signed automatically by transaction_type." },
              category: { type: "string" },
              transaction_type: { type: "string", enum: ["expense", "income", "transfer"] },
              notes: { type: "string" },
              import_fingerprint: { type: "string", description: "Optional custom dedupe key; auto-generated if omitted." },
            },
            required: ["date", "name", "amount"],
            additionalProperties: false,
          },
        },
      },
      required: ["transactions"],
      additionalProperties: false,
    },
    annotations: WRITE_CREATE,
  },
  {
    name: "delete_transaction",
    description: "Delete a single transaction by transaction_id.",
    inputSchema: {
      type: "object",
      properties: {
        transaction_id: { type: "string" },
      },
      required: ["transaction_id"],
      additionalProperties: false,
    },
    annotations: DESTRUCTIVE,
  },
  {
    name: "delete_transactions_for_source",
    description:
      "Delete all transactions linked to a specific account, credit card, or all Teller-synced transactions (source_type='teller').",
    inputSchema: {
      type: "object",
      properties: {
        source_type: { type: "string", enum: ["account", "card", "teller"] },
        account_id: { type: "string" },
        account_name: { type: "string" },
        card_id: { type: "string" },
        card_name: { type: "string" },
      },
      required: ["source_type"],
      additionalProperties: false,
    },
    annotations: DESTRUCTIVE,
  },
  {
    name: "get_transaction_coverage",
    description:
      "Get monthly imported-transaction counts for a calendar year, optionally filtered to a single account or credit card.",
    inputSchema: {
      type: "object",
      properties: {
        year: { type: "integer", minimum: 2000, maximum: 2100, description: "Defaults to current UTC year." },
        account_id: { type: "string" },
        account_name: { type: "string" },
        card_id: { type: "string" },
        card_name: { type: "string" },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "split_transaction",
    description:
      "Split an existing transaction into two manual transactions (part_a and part_b). Deletes purely manual originals, or marks imported/synced originals ignored with [split] so bank/CSV re-imports will not duplicate them.",
    inputSchema: {
      type: "object",
      properties: {
        transaction_id: { type: "string", description: "ID of the transaction to split." },
        part_a: {
          type: "object",
          properties: {
            name: { type: "string", description: "Defaults to '<original> (your part)'." },
            amount: { type: "number", description: "Positive amount for part A." },
            category: { type: "string", description: "Defaults to the original transaction's category." },
            transaction_type: { type: "string", enum: ["expense", "income", "transfer"] },
          },
          required: ["amount"],
          additionalProperties: false,
        },
        part_b: {
          type: "object",
          properties: {
            name: { type: "string", description: "Defaults to '<original> (other part)'." },
            amount: { type: "number", description: "Positive amount for part B." },
            category: { type: "string", description: "Defaults to the original transaction's category." },
            transaction_type: { type: "string", enum: ["expense", "income", "transfer"] },
          },
          required: ["amount"],
          additionalProperties: false,
        },
      },
      required: ["transaction_id", "part_a", "part_b"],
      additionalProperties: false,
    },
    annotations: WRITE_CREATE,
  },
  {
    name: "find_refund_candidates",
    description:
      "Find and rank likely refund/original partner transactions within ±90 days (configurable) for a given transaction_id.",
    inputSchema: {
      type: "object",
      properties: {
        transaction_id: { type: "string" },
        window_days: { type: "integer", minimum: 1, maximum: 365, description: "Search window in days (default 90)." },
        limit: { type: "integer", minimum: 1, maximum: 50, description: "Max candidates to return (default 20)." },
      },
      required: ["transaction_id"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "link_refund_transactions",
    description:
      "Link an original purchase and its refund transaction so both are ignored and tagged with bidirectional [refund:...] links. Set create_net_difference=true for partial refunds to create a net '<merchant> (after refund)' transaction for the remaining balance.",
    inputSchema: {
      type: "object",
      properties: {
        transaction_a_id: { type: "string", description: "First transaction ID (original or refund)." },
        transaction_b_id: { type: "string", description: "Partner transaction ID (refund or original)." },
        create_net_difference: {
          type: "boolean",
          description: "If true and |original| - |refund| >= 0.01, create a net expense transaction for the difference (default false).",
        },
      },
      required: ["transaction_a_id", "transaction_b_id"],
      additionalProperties: false,
    },
    annotations: WRITE_IDEMPOTENT,
  },
  {
    name: "unlink_refund_transactions",
    description:
      "Unlink a refund-linked transaction and its partner, removing their [refund:...] tags and restoring both to active (is_ignored=false).",
    inputSchema: {
      type: "object",
      properties: {
        transaction_id: { type: "string" },
      },
      required: ["transaction_id"],
      additionalProperties: false,
    },
    annotations: WRITE_IDEMPOTENT,
  },

  // ── Planner Config Update ──────────────────────────────────────────────────
  {
    name: "update_planner_config",
    description:
      "Update planner settings (tax_filing_status, paid_loan_ids, paid_loan_month, dismissed_suggestions, or shallow-merge fields into config JSON).",
    inputSchema: {
      type: "object",
      properties: {
        tax_filing_status: { type: "string", enum: ["single", "mfj", "mfs", "hoh"] },
        paid_loan_ids: { type: "array", items: { type: "string" } },
        paid_loan_month: { type: "string" },
        dismissed_suggestions: { type: "array", items: { type: "string" } },
        config_patch: { type: "object", description: "Shallow-merged into planner_configs.config JSON." },
      },
      additionalProperties: false,
    },
    annotations: WRITE_IDEMPOTENT,
  },
  {
    name: "manage_planner_item",
    description:
      "Add, update, or delete an individual item inside a planner_configs.config collection (salaryPeriods, recurringCharges, recurringBonuses, vestingGrants, events, or scenarioEvents) without overwriting the rest of the planner config.",
    inputSchema: {
      type: "object",
      properties: {
        collection: {
          type: "string",
          enum: [
            "salaryPeriods",
            "recurringCharges",
            "recurringBonuses",
            "vestingGrants",
            "events",
            "scenarioEvents",
          ],
        },
        action: { type: "string", enum: ["upsert", "delete"] },
        item_id: { type: "string", description: "Item ID to delete (or update if not provided inside item.id)." },
        item: {
          type: "object",
          description: "Item fields to create or merge into the existing item when action='upsert'.",
        },
      },
      required: ["collection", "action"],
      additionalProperties: false,
    },
    annotations: WRITE_IDEMPOTENT,
  },
  {
    name: "update_tax_tracking",
    description:
      "Update Tax Center settings: tax_filing_status and/or fields for a specific tax year in planner_configs.config.taxYearTracking[year].",
    inputSchema: {
      type: "object",
      properties: {
        year: { type: "string", description: "4-digit tax year (e.g. '2026'). Required when passing tracking_patch." },
        tax_filing_status: { type: "string", enum: ["single", "mfj", "mfs", "hoh"] },
        tracking_patch: {
          type: "object",
          description:
            "Fields to merge into taxYearTracking[year] (actualGrossIncome, actualWithholding, expectedRemainingGross, expectedRemainingWithholding, estimatedPayments, taxCredits, expectedRefundDate, estimatedRefundAmount, estimatedTaxBalance, refundReceived, refundReceivedDate, otherIncome).",
        },
      },
      additionalProperties: false,
    },
    annotations: WRITE_IDEMPOTENT,
  },
];

async function authenticateRequest(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const url = new URL(req.url);
  const bearerToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : url.searchParams.get("token")?.trim() ?? "";

  if (!bearerToken) return null;

  const configuredToken = Deno.env.get("BEANCOUNT_MCP_TOKEN")?.trim();
  const configuredUserId = Deno.env.get("BEANCOUNT_MCP_USER_ID")?.trim();
  if (configuredToken && configuredUserId && constantTimeEqual(bearerToken, configuredToken)) {
    return configuredUserId;
  }

  if (authHeader.startsWith("Bearer ")) {
    const supabase = getSupabaseClient(authHeader);
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.id) return user.id;
  }

  return null;
}

function okResult(data: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function errResult(message: string) {
  return { isError: true, content: [{ type: "text", text: message }] };
}

function currentMonthRange() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const lastDay = new Date(Date.UTC(y, now.getUTCMonth() + 1, 0)).getUTCDate();
  return { start: `${y}-${m}-01`, end: `${y}-${m}-${String(lastDay).padStart(2, "0")}` };
}

function parseOptionalDate(val: unknown): string | null | undefined {
  if (val === undefined) return undefined;
  if (val === null || val === "") return null;
  if (typeof val === "string" && /^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  throw new Error("Date must be in YYYY-MM-DD format (or empty string to clear).");
}

async function handleToolCall(
  userId: string,
  name: string,
  args: Record<string, unknown>
) {
  const admin = getSupabaseAdmin();

  switch (name) {
    // ── Reads ────────────────────────────────────────────────────────────────
    case "get_net_worth": {
      const historyDays = Math.min(365, Math.max(1, Number(args.history_days ?? 30)));
      const [accountsRes, cardsRes, debtsRes, liabsRes, loansRes, historyRes] =
        await Promise.all([
          admin.from("accounts").select("type, balance").eq("user_id", userId),
          admin.from("credit_cards").select("balance_owed, points_balance, points_value_cents").eq("user_id", userId),
          admin.from("debts_owed").select("amount").eq("user_id", userId).neq("status", "paid"),
          admin.from("liabilities").select("amount").eq("user_id", userId),
          admin.from("loans").select("balance").eq("user_id", userId),
          admin
            .from("net_worth_snapshots")
            .select("snapshot_date, net_worth, assets_total, stock_total, crypto_total")
            .eq("user_id", userId)
            .order("snapshot_date", { ascending: false })
            .limit(historyDays),
        ]);

      for (const r of [accountsRes, cardsRes, debtsRes, liabsRes, loansRes, historyRes]) {
        if (r.error) return errResult(`Database error: ${r.error.message}`);
      }

      let bankTotal = 0, cashTotal = 0, stockTotal = 0, cryptoTotal = 0;
      for (const a of accountsRes.data ?? []) {
        const bal = Number(a.balance);
        if (a.type === "bank") bankTotal += bal;
        else if (a.type === "cash") cashTotal += bal;
        else if (a.type === "stock") stockTotal += bal;
        else if (a.type === "crypto") cryptoTotal += bal;
      }
      const assetsTotal = bankTotal + cashTotal + stockTotal + cryptoTotal;
      const creditCardDebt = (cardsRes.data ?? []).reduce((s, c) => s + Math.max(0, Number(c.balance_owed)), 0);
      const pointsValue = (cardsRes.data ?? []).reduce(
        (s, c) => s + (Number(c.points_balance) * Number(c.points_value_cents)) / 100,
        0
      );
      const debtsOwedTotal = (debtsRes.data ?? []).reduce((s, d) => s + Number(d.amount), 0);
      const liabilitiesTotal = (liabsRes.data ?? []).reduce((s, l) => s + Number(l.amount), 0);
      const loansTotal = (loansRes.data ?? []).reduce((s, l) => s + Number(l.balance), 0);
      const netWorth = assetsTotal + debtsOwedTotal + pointsValue - creditCardDebt - liabilitiesTotal;

      return okResult({
        totals: {
          netWorth: Number(netWorth.toFixed(2)),
          assetsTotal: Number(assetsTotal.toFixed(2)),
          bankTotal: Number(bankTotal.toFixed(2)),
          cashTotal: Number(cashTotal.toFixed(2)),
          stockTotal: Number(stockTotal.toFixed(2)),
          cryptoTotal: Number(cryptoTotal.toFixed(2)),
          debtsOwedTotal: Number(debtsOwedTotal.toFixed(2)),
          pointsValue: Number(pointsValue.toFixed(2)),
          creditCardDebt: Number(creditCardDebt.toFixed(2)),
          liabilitiesTotal: Number(liabilitiesTotal.toFixed(2)),
          loansTotal: Number(loansTotal.toFixed(2)),
        },
        recentSnapshots: (historyRes.data ?? []).reverse(),
      });
    }

    case "list_accounts": {
      let accQuery = admin
        .from("accounts")
        .select("id, name, type, balance, currency, icon, color, updated_at")
        .eq("user_id", userId)
        .order("type")
        .order("balance", { ascending: false });
      if (typeof args.type === "string") accQuery = accQuery.eq("type", args.type);

      const [accRes, cardRes] = await Promise.all([
        accQuery,
        admin
          .from("credit_cards")
          .select("id, name, balance_owed, credit_limit, points_balance, points_value_cents, due_date, min_payment, color, updated_at")
          .eq("user_id", userId)
          .order("balance_owed", { ascending: false }),
      ]);
      if (accRes.error) return errResult(`Database error: ${accRes.error.message}`);
      if (cardRes.error) return errResult(`Database error: ${cardRes.error.message}`);

      return okResult({ accounts: accRes.data ?? [], creditCards: cardRes.data ?? [] });
    }

    case "list_debts_and_liabilities": {
      let debtQuery = admin
        .from("debts_owed")
        .select("id, person_name, amount, reason, due_date, status, updated_at")
        .eq("user_id", userId)
        .order("amount", { ascending: false });
      if (args.include_paid_debts === false) debtQuery = debtQuery.neq("status", "paid");

      const [debtsRes, liabsRes] = await Promise.all([
        debtQuery,
        admin
          .from("liabilities")
          .select("id, name, amount, category, notes, due_date, updated_at")
          .eq("user_id", userId)
          .order("amount", { ascending: false }),
      ]);
      if (debtsRes.error) return errResult(`Database error: ${debtsRes.error.message}`);
      if (liabsRes.error) return errResult(`Database error: ${liabsRes.error.message}`);

      return okResult({ debtsOwed: debtsRes.data ?? [], liabilities: liabsRes.data ?? [] });
    }

    case "list_holdings_and_loans": {
      const [holdingsRes, loansRes] = await Promise.all([
        admin
          .from("stock_holdings")
          .select("id, ticker, shares, cost_basis, account_id, accounts(name, type)")
          .eq("user_id", userId)
          .order("ticker"),
        admin
          .from("loans")
          .select("id, name, type, balance, original_amount, interest_rate, monthly_payment, payment_day, deferral_months, deferral_type, notes, updated_at")
          .eq("user_id", userId)
          .order("balance", { ascending: false }),
      ]);
      if (holdingsRes.error) return errResult(`Database error: ${holdingsRes.error.message}`);
      if (loansRes.error) return errResult(`Database error: ${loansRes.error.message}`);
      return okResult({ holdings: holdingsRes.data ?? [], loans: loansRes.data ?? [] });
    }

    case "search_transactions": {
      const limit = Math.min(200, Math.max(1, Number(args.limit ?? 50)));
      const includeSplitOriginals = args.include_split_originals === true;
      const fetchLimit = includeSplitOriginals ? limit : Math.min(250, limit + 50);

      let q = admin
        .from("transactions")
        .select("id, date, name, merchant_name, amount, category, transaction_type, is_ignored, notes, account_id, credit_card_id")
        .eq("user_id", userId)
        .order("date", { ascending: false })
        .limit(fetchLimit);

      if (typeof args.start_date === "string") q = q.gte("date", args.start_date);
      if (typeof args.end_date === "string") q = q.lte("date", args.end_date);
      if (typeof args.category === "string") q = q.eq("category", args.category);
      if (typeof args.transaction_type === "string") q = q.eq("transaction_type", args.transaction_type);
      if (typeof args.account_id === "string" && args.account_id.trim()) {
        q = q.eq("account_id", args.account_id.trim());
      }
      if (typeof args.credit_card_id === "string" && args.credit_card_id.trim()) {
        q = q.eq("credit_card_id", args.credit_card_id.trim());
      }
      if (typeof args.is_ignored === "boolean") q = q.eq("is_ignored", args.is_ignored);
      if (typeof args.query === "string" && args.query.trim()) {
        const escaped = args.query.trim().replace(/[%_,]/g, "");
        if (escaped) q = q.or(`name.ilike.%${escaped}%,merchant_name.ilike.%${escaped}%`);
      }

      const { data, error } = await q;
      if (error) return errResult(`Database error: ${error.message}`);

      const rows = (data ?? [])
        .filter((tx) => includeSplitOriginals || !isSplitOriginal(tx))
        .slice(0, limit)
        .map((tx) => {
          const refundLink = parseRefundLink(tx.notes);
          return refundLink ? { ...tx, refund_link: refundLink } : tx;
        });

      return okResult({ count: rows.length, transactions: rows });
    }

    case "get_spending_summary": {
      const defaults = currentMonthRange();
      const start = typeof args.start_date === "string" ? args.start_date : defaults.start;
      const end = typeof args.end_date === "string" ? args.end_date : defaults.end;
      const { data, error } = await admin
        .from("transactions")
        .select("amount, category, transaction_type, is_ignored")
        .eq("user_id", userId)
        .eq("is_ignored", false)
        .gte("date", start)
        .lte("date", end);
      if (error) return errResult(`Database error: ${error.message}`);
      return okResult({ period: { start_date: start, end_date: end }, ...summarizeTransactions(data ?? []) });
    }

    case "get_planner_config": {
      const { data, error } = await admin
        .from("planner_configs")
        .select("config, paid_loan_ids, paid_loan_month, dismissed_suggestions, tax_filing_status, updated_at")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) return errResult(`Database error: ${error.message}`);
      return okResult(data ?? { config: {}, paid_loan_ids: [], paid_loan_month: "", dismissed_suggestions: [], tax_filing_status: "single" });
    }

    case "save_net_worth_snapshot": {
      const snapshotDate =
        typeof args.snapshot_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.snapshot_date)
          ? args.snapshot_date
          : new Date().toISOString().slice(0, 10);

      const needsAutoCompute =
        args.net_worth === undefined ||
        args.assets_total === undefined ||
        args.stock_total === undefined ||
        args.crypto_total === undefined;

      let autoNetWorth = 0;
      let autoAssetsTotal = 0;
      let autoStockTotal = 0;
      let autoCryptoTotal = 0;

      if (needsAutoCompute) {
        const [accountsRes, cardsRes, debtsRes, liabsRes] = await Promise.all([
          admin.from("accounts").select("type, balance").eq("user_id", userId),
          admin.from("credit_cards").select("balance_owed, points_balance, points_value_cents").eq("user_id", userId),
          admin.from("debts_owed").select("amount").eq("user_id", userId).neq("status", "paid"),
          admin.from("liabilities").select("amount").eq("user_id", userId),
        ]);
        for (const r of [accountsRes, cardsRes, debtsRes, liabsRes]) {
          if (r.error) return errResult(`Database error: ${r.error.message}`);
        }
        let bankTotal = 0, cashTotal = 0;
        for (const a of accountsRes.data ?? []) {
          const bal = Number(a.balance);
          if (a.type === "bank") bankTotal += bal;
          else if (a.type === "cash") cashTotal += bal;
          else if (a.type === "stock") autoStockTotal += bal;
          else if (a.type === "crypto") autoCryptoTotal += bal;
        }
        autoAssetsTotal = bankTotal + cashTotal + autoStockTotal + autoCryptoTotal;
        const creditCardDebt = (cardsRes.data ?? []).reduce((s, c) => s + Math.max(0, Number(c.balance_owed)), 0);
        const pointsValue = (cardsRes.data ?? []).reduce(
          (s, c) => s + (Number(c.points_balance) * Number(c.points_value_cents)) / 100,
          0
        );
        const debtsOwedTotal = (debtsRes.data ?? []).reduce((s, d) => s + Number(d.amount), 0);
        const liabilitiesTotal = (liabsRes.data ?? []).reduce((s, l) => s + Number(l.amount), 0);
        autoNetWorth = autoAssetsTotal + debtsOwedTotal + pointsValue - creditCardDebt - liabilitiesTotal;
      }

      const netWorth = args.net_worth !== undefined ? Number(args.net_worth) : Number(autoNetWorth.toFixed(2));
      const assetsTotal = args.assets_total !== undefined ? Number(args.assets_total) : Number(autoAssetsTotal.toFixed(2));
      const stockTotal = args.stock_total !== undefined ? Number(args.stock_total) : Number(autoStockTotal.toFixed(2));
      const cryptoTotal = args.crypto_total !== undefined ? Number(args.crypto_total) : Number(autoCryptoTotal.toFixed(2));

      if (![netWorth, assetsTotal, stockTotal, cryptoTotal].every(Number.isFinite)) {
        return errResult("Snapshot totals must be valid numbers.");
      }

      const { data, error } = await admin
        .from("net_worth_snapshots")
        .upsert(
          {
            user_id: userId,
            snapshot_date: snapshotDate,
            net_worth: netWorth,
            assets_total: assetsTotal,
            stock_total: stockTotal,
            crypto_total: cryptoTotal,
          },
          { onConflict: "user_id,snapshot_date" }
        )
        .select("id, snapshot_date, net_worth, assets_total, stock_total, crypto_total, created_at")
        .single();
      if (error) return errResult(`Failed to save net worth snapshot: ${error.message}`);
      return okResult({ saved: true, snapshot: data });
    }

    case "delete_net_worth_snapshot": {
      const snapId = typeof args.snapshot_id === "string" ? args.snapshot_id.trim() : "";
      const snapDate = typeof args.snapshot_date === "string" ? args.snapshot_date.trim() : "";
      if (!snapId && !snapDate) return errResult("Provide snapshot_id or snapshot_date (YYYY-MM-DD).");
      if (snapDate && !/^\d{4}-\d{2}-\d{2}$/.test(snapDate)) {
        return errResult("snapshot_date must be YYYY-MM-DD.");
      }

      let q = admin
        .from("net_worth_snapshots")
        .delete()
        .eq("user_id", userId);
      q = snapId ? q.eq("id", snapId) : q.eq("snapshot_date", snapDate);
      const { data, error } = await q.select("id, snapshot_date, net_worth").maybeSingle();
      if (error) return errResult(`Failed to delete snapshot: ${error.message}`);
      if (!data) return errResult("No matching net worth snapshot found.");
      return okResult({ deleted: true, snapshot: data });
    }

    // ── Merchant Category Rules ──────────────────────────────────────────────
    case "list_merchant_category_rules": {
      const { data, error } = await admin
        .from("merchant_category_rules")
        .select("merchant_key, category, transaction_type, updated_at")
        .eq("user_id", userId)
        .order("merchant_key");
      if (error) return errResult(`Database error: ${error.message}`);
      return okResult({ count: data?.length ?? 0, rules: data ?? [] });
    }

    case "upsert_merchant_category_rule": {
      const merchantKey = normalizeMerchantKey(typeof args.merchant === "string" ? args.merchant : "");
      if (!merchantKey) return errResult("merchant must contain at least one letter or digit.");
      const category = typeof args.category === "string" ? args.category : "";
      if (!VALID_CATEGORIES.has(category)) return errResult(`Invalid category "${category}".`);
      const transactionType =
        typeof args.transaction_type === "string"
          ? args.transaction_type
          : defaultTransactionTypeForCategory(category);
      if (!VALID_TRANSACTION_TYPES.has(transactionType)) {
        return errResult("transaction_type must be expense, income, or transfer.");
      }

      const { data: rule, error } = await admin
        .from("merchant_category_rules")
        .upsert(
          {
            user_id: userId,
            merchant_key: merchantKey,
            category,
            transaction_type: transactionType,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,merchant_key" }
        )
        .select("merchant_key, category, transaction_type, updated_at")
        .single();
      if (error) return errResult(`Failed to save merchant rule: ${error.message}`);

      let retroactivelyUpdated = 0;
      if (args.apply_to_existing === true) {
        const { data: txns, error: txErr } = await admin
          .from("transactions")
          .select("id, name, merchant_name")
          .eq("user_id", userId)
          .eq("is_ignored", false);
        if (txErr) return errResult(`Saved rule, but failed to fetch transactions: ${txErr.message}`);
        const matchingIds = (txns ?? [])
          .filter((t) => normalizeMerchantKey(t.merchant_name || t.name) === merchantKey)
          .map((t) => t.id);
        if (matchingIds.length > 0) {
          const { error: bulkErr } = await admin
            .from("transactions")
            .update({ category, transaction_type: transactionType })
            .in("id", matchingIds)
            .eq("user_id", userId);
          if (bulkErr) return errResult(`Saved rule, but failed to update existing transactions: ${bulkErr.message}`);
          retroactivelyUpdated = matchingIds.length;
        }
      }

      return okResult({ saved: true, rule, retroactively_updated: retroactivelyUpdated });
    }

    case "delete_merchant_category_rule": {
      const merchantKey = normalizeMerchantKey(typeof args.merchant === "string" ? args.merchant : "");
      if (!merchantKey) return errResult("merchant is required.");
      const { data, error } = await admin
        .from("merchant_category_rules")
        .delete()
        .eq("user_id", userId)
        .eq("merchant_key", merchantKey)
        .select("merchant_key, category, transaction_type")
        .maybeSingle();
      if (error) return errResult(`Failed to delete merchant rule: ${error.message}`);
      if (!data) return errResult(`No merchant rule found for "${merchantKey}".`);
      return okResult({ deleted: true, rule: data });
    }

    // ── Accounts CRUD ────────────────────────────────────────────────────────
    case "create_account": {
      const accName = typeof args.name === "string" ? args.name.trim() : "";
      const type = typeof args.type === "string" ? args.type : "";
      if (!accName) return errResult("name is required.");
      if (!["bank", "cash", "stock", "crypto"].includes(type)) {
        return errResult("type must be bank, cash, stock, or crypto.");
      }
      const balance = args.balance !== undefined ? Number(args.balance) : 0;
      if (!Number.isFinite(balance)) return errResult("balance must be a valid number.");

      const { data, error } = await admin
        .from("accounts")
        .insert({
          user_id: userId,
          name: accName,
          type,
          balance,
          currency: typeof args.currency === "string" && args.currency.trim() ? args.currency.trim().toUpperCase() : "USD",
          icon: typeof args.icon === "string" ? args.icon : null,
          color: typeof args.color === "string" ? args.color : null,
        })
        .select("id, name, type, balance, currency, icon, color")
        .single();
      if (error) return errResult(`Failed to create account: ${error.message}`);
      return okResult({ created: true, account: data });
    }

    case "update_account":
    case "update_account_balance": {
      const updates: Record<string, unknown> = {};
      if (typeof args.name === "string" && args.name.trim()) updates.name = args.name.trim();
      if (typeof args.type === "string") {
        if (!["bank", "cash", "stock", "crypto"].includes(args.type)) {
          return errResult("type must be bank, cash, stock, or crypto.");
        }
        updates.type = args.type;
      }
      if (args.balance !== undefined) {
        const balance = Number(args.balance);
        if (!Number.isFinite(balance)) return errResult("balance must be a valid number.");
        updates.balance = balance;
      }
      if (typeof args.currency === "string" && args.currency.trim()) {
        updates.currency = args.currency.trim().toUpperCase();
      }
      if (args.icon !== undefined) updates.icon = typeof args.icon === "string" ? args.icon : null;
      if (args.color !== undefined) updates.color = typeof args.color === "string" ? args.color : null;
      if (Object.keys(updates).length === 0) return errResult("Provide at least one field to update.");

      const { data: accounts, error: fetchErr } = await admin
        .from("accounts")
        .select("id, name, type, balance, currency")
        .eq("user_id", userId);
      if (fetchErr) return errResult(`Database error: ${fetchErr.message}`);

      const resolved = resolveNamedEntity(
        accounts ?? [],
        typeof args.account_id === "string" ? args.account_id : undefined,
        typeof args.account_name === "string" ? args.account_name : undefined,
        "account"
      );
      if (!resolved.ok) return errResult(resolved.error);

      const target = resolved.match;
      const { data: updated, error: updateErr } = await admin
        .from("accounts")
        .update(updates)
        .eq("id", target.id)
        .eq("user_id", userId)
        .select("id, name, type, balance, currency, icon, color, updated_at")
        .single();
      if (updateErr) return errResult(`Failed to update account: ${updateErr.message}`);
      return okResult({ updated: true, account: updated, previous_balance: Number(target.balance) });
    }

    case "delete_account": {
      const { data: accounts, error: fetchErr } = await admin
        .from("accounts")
        .select("id, name, type, balance")
        .eq("user_id", userId);
      if (fetchErr) return errResult(`Database error: ${fetchErr.message}`);

      const resolved = resolveNamedEntity(
        accounts ?? [],
        typeof args.account_id === "string" ? args.account_id : undefined,
        typeof args.account_name === "string" ? args.account_name : undefined,
        "account"
      );
      if (!resolved.ok) return errResult(resolved.error);

      const target = resolved.match;
      // Preserve source_name on linked transactions before deleting account.
      await admin
        .from("transactions")
        .update({ source_name: target.name })
        .eq("account_id", target.id)
        .eq("user_id", userId)
        .is("source_name", null);

      const { error: delErr } = await admin
        .from("accounts")
        .delete()
        .eq("id", target.id)
        .eq("user_id", userId);
      if (delErr) return errResult(`Failed to delete account: ${delErr.message}`);
      return okResult({ deleted: true, account: target });
    }

    // ── Credit Cards CRUD ────────────────────────────────────────────────────
    case "create_credit_card": {
      const cardName = typeof args.name === "string" ? args.name.trim() : "";
      if (!cardName) return errResult("name is required.");
      const dueDate = parseOptionalDate(args.due_date) ?? null;

      const { data, error } = await admin
        .from("credit_cards")
        .insert({
          user_id: userId,
          name: cardName,
          balance_owed: Number(args.balance_owed ?? 0),
          credit_limit: Number(args.credit_limit ?? 0),
          points_balance: Number(args.points_balance ?? 0),
          points_value_cents: Number(args.points_value_cents ?? 1),
          due_date: dueDate,
          min_payment: Number(args.min_payment ?? 0),
          color: typeof args.color === "string" ? args.color : null,
        })
        .select("id, name, balance_owed, credit_limit, points_balance, points_value_cents, due_date, min_payment, color")
        .single();
      if (error) return errResult(`Failed to create credit card: ${error.message}`);
      return okResult({ created: true, creditCard: data });
    }

    case "update_credit_card":
    case "update_credit_card_balance": {
      const updates: Record<string, unknown> = {};
      if (typeof args.name === "string" && args.name.trim()) updates.name = args.name.trim();
      for (const f of ["balance_owed", "credit_limit", "points_balance", "points_value_cents", "min_payment"] as const) {
        if (args[f] !== undefined) {
          const val = Number(args[f]);
          if (!Number.isFinite(val)) return errResult(`${f} must be a valid number.`);
          updates[f] = val;
        }
      }
      const dueDate = parseOptionalDate(args.due_date);
      if (dueDate !== undefined) updates.due_date = dueDate;
      if (args.color !== undefined) updates.color = typeof args.color === "string" ? args.color : null;
      if (Object.keys(updates).length === 0) return errResult("Provide at least one field to update.");

      const { data: cards, error: fetchErr } = await admin
        .from("credit_cards")
        .select("id, name, balance_owed, points_balance")
        .eq("user_id", userId);
      if (fetchErr) return errResult(`Database error: ${fetchErr.message}`);

      const resolved = resolveNamedEntity(
        cards ?? [],
        typeof args.card_id === "string" ? args.card_id : undefined,
        typeof args.card_name === "string" ? args.card_name : undefined,
        "card"
      );
      if (!resolved.ok) return errResult(resolved.error);

      const target = resolved.match;
      const { data: updated, error: updateErr } = await admin
        .from("credit_cards")
        .update(updates)
        .eq("id", target.id)
        .eq("user_id", userId)
        .select("id, name, balance_owed, credit_limit, points_balance, points_value_cents, due_date, min_payment, color, updated_at")
        .single();
      if (updateErr) return errResult(`Failed to update credit card: ${updateErr.message}`);
      return okResult({ updated: true, creditCard: updated, previous_balance_owed: Number(target.balance_owed) });
    }

    case "delete_credit_card": {
      const { data: cards, error: fetchErr } = await admin
        .from("credit_cards")
        .select("id, name, balance_owed")
        .eq("user_id", userId);
      if (fetchErr) return errResult(`Database error: ${fetchErr.message}`);

      const resolved = resolveNamedEntity(
        cards ?? [],
        typeof args.card_id === "string" ? args.card_id : undefined,
        typeof args.card_name === "string" ? args.card_name : undefined,
        "card"
      );
      if (!resolved.ok) return errResult(resolved.error);

      const target = resolved.match;
      await admin
        .from("transactions")
        .update({ source_name: target.name })
        .eq("credit_card_id", target.id)
        .eq("user_id", userId)
        .is("source_name", null);

      const { error: delErr } = await admin
        .from("credit_cards")
        .delete()
        .eq("id", target.id)
        .eq("user_id", userId);
      if (delErr) return errResult(`Failed to delete credit card: ${delErr.message}`);
      return okResult({ deleted: true, creditCard: target });
    }

    // ── Debts Owed CRUD ──────────────────────────────────────────────────────
    case "create_debt_owed": {
      const person = typeof args.person_name === "string" ? args.person_name.trim() : "";
      const amount = Number(args.amount);
      if (!person) return errResult("person_name is required.");
      if (!Number.isFinite(amount) || amount < 0) return errResult("amount must be a non-negative number.");
      const status = typeof args.status === "string" && ["pending", "partial", "paid"].includes(args.status)
        ? args.status
        : "pending";
      const dueDate = parseOptionalDate(args.due_date) ?? null;

      const { data, error } = await admin
        .from("debts_owed")
        .insert({
          user_id: userId,
          person_name: person,
          amount,
          reason: typeof args.reason === "string" ? args.reason : null,
          due_date: dueDate,
          status,
        })
        .select("id, person_name, amount, reason, due_date, status")
        .single();
      if (error) return errResult(`Failed to create debt owed: ${error.message}`);
      return okResult({ created: true, debtOwed: data });
    }

    case "update_debt_owed": {
      const updates: Record<string, unknown> = {};
      if (typeof args.person_name === "string" && args.person_name.trim()) updates.person_name = args.person_name.trim();
      if (args.amount !== undefined) {
        const val = Number(args.amount);
        if (!Number.isFinite(val) || val < 0) return errResult("amount must be a non-negative number.");
        updates.amount = val;
      }
      if (args.reason !== undefined) updates.reason = typeof args.reason === "string" ? args.reason : null;
      const dueDate = parseOptionalDate(args.due_date);
      if (dueDate !== undefined) updates.due_date = dueDate;
      if (args.status !== undefined) {
        if (!["pending", "partial", "paid"].includes(String(args.status))) {
          return errResult("status must be pending, partial, or paid.");
        }
        updates.status = args.status;
      }
      if (Object.keys(updates).length === 0) return errResult("Provide at least one field to update.");

      const { data: debts, error: fetchErr } = await admin
        .from("debts_owed")
        .select("id, person_name, amount, status")
        .eq("user_id", userId);
      if (fetchErr) return errResult(`Database error: ${fetchErr.message}`);

      const resolved = resolveNamedEntity(
        (debts ?? []).map((d) => ({ ...d, name: d.person_name })),
        typeof args.debt_id === "string" ? args.debt_id : undefined,
        typeof args.match_person_name === "string" ? args.match_person_name : undefined,
        "debt"
      );
      if (!resolved.ok) return errResult(resolved.error);

      const { data: updated, error: updateErr } = await admin
        .from("debts_owed")
        .update(updates)
        .eq("id", resolved.match.id)
        .eq("user_id", userId)
        .select("id, person_name, amount, reason, due_date, status, updated_at")
        .single();
      if (updateErr) return errResult(`Failed to update debt owed: ${updateErr.message}`);
      return okResult({ updated: true, debtOwed: updated });
    }

    case "delete_debt_owed": {
      const { data: debts, error: fetchErr } = await admin
        .from("debts_owed")
        .select("id, person_name, amount, status")
        .eq("user_id", userId);
      if (fetchErr) return errResult(`Database error: ${fetchErr.message}`);

      const resolved = resolveNamedEntity(
        (debts ?? []).map((d) => ({ ...d, name: d.person_name })),
        typeof args.debt_id === "string" ? args.debt_id : undefined,
        typeof args.match_person_name === "string" ? args.match_person_name : undefined,
        "debt"
      );
      if (!resolved.ok) return errResult(resolved.error);

      const { error: delErr } = await admin
        .from("debts_owed")
        .delete()
        .eq("id", resolved.match.id)
        .eq("user_id", userId);
      if (delErr) return errResult(`Failed to delete debt owed: ${delErr.message}`);
      return okResult({ deleted: true, debtOwed: resolved.match });
    }

    // ── Liabilities CRUD ─────────────────────────────────────────────────────
    case "create_liability": {
      const liabName = typeof args.name === "string" ? args.name.trim() : "";
      const amount = Number(args.amount);
      if (!liabName) return errResult("name is required.");
      if (!Number.isFinite(amount) || amount < 0) return errResult("amount must be a non-negative number.");
      const dueDate = parseOptionalDate(args.due_date) ?? null;

      const { data, error } = await admin
        .from("liabilities")
        .insert({
          user_id: userId,
          name: liabName,
          amount,
          category: typeof args.category === "string" && args.category.trim() ? args.category.trim() : "other",
          notes: typeof args.notes === "string" ? args.notes : null,
          due_date: dueDate,
        })
        .select("id, name, amount, category, notes, due_date")
        .single();
      if (error) return errResult(`Failed to create liability: ${error.message}`);
      return okResult({ created: true, liability: data });
    }

    case "update_liability": {
      const updates: Record<string, unknown> = {};
      if (typeof args.name === "string" && args.name.trim()) updates.name = args.name.trim();
      if (args.amount !== undefined) {
        const val = Number(args.amount);
        if (!Number.isFinite(val) || val < 0) return errResult("amount must be a non-negative number.");
        updates.amount = val;
      }
      if (typeof args.category === "string" && args.category.trim()) updates.category = args.category.trim();
      if (args.notes !== undefined) updates.notes = typeof args.notes === "string" ? args.notes : null;
      const dueDate = parseOptionalDate(args.due_date);
      if (dueDate !== undefined) updates.due_date = dueDate;
      if (Object.keys(updates).length === 0) return errResult("Provide at least one field to update.");

      const { data: liabs, error: fetchErr } = await admin
        .from("liabilities")
        .select("id, name, amount")
        .eq("user_id", userId);
      if (fetchErr) return errResult(`Database error: ${fetchErr.message}`);

      const resolved = resolveNamedEntity(
        liabs ?? [],
        typeof args.liability_id === "string" ? args.liability_id : undefined,
        typeof args.liability_name === "string" ? args.liability_name : undefined,
        "liability"
      );
      if (!resolved.ok) return errResult(resolved.error);

      const { data: updated, error: updateErr } = await admin
        .from("liabilities")
        .update(updates)
        .eq("id", resolved.match.id)
        .eq("user_id", userId)
        .select("id, name, amount, category, notes, due_date, updated_at")
        .single();
      if (updateErr) return errResult(`Failed to update liability: ${updateErr.message}`);
      return okResult({ updated: true, liability: updated });
    }

    case "delete_liability": {
      const { data: liabs, error: fetchErr } = await admin
        .from("liabilities")
        .select("id, name, amount")
        .eq("user_id", userId);
      if (fetchErr) return errResult(`Database error: ${fetchErr.message}`);

      const resolved = resolveNamedEntity(
        liabs ?? [],
        typeof args.liability_id === "string" ? args.liability_id : undefined,
        typeof args.liability_name === "string" ? args.liability_name : undefined,
        "liability"
      );
      if (!resolved.ok) return errResult(resolved.error);

      const { error: delErr } = await admin
        .from("liabilities")
        .delete()
        .eq("id", resolved.match.id)
        .eq("user_id", userId);
      if (delErr) return errResult(`Failed to delete liability: ${delErr.message}`);
      return okResult({ deleted: true, liability: resolved.match });
    }

    // ── Loans CRUD ───────────────────────────────────────────────────────────
    case "create_loan": {
      const loanName = typeof args.name === "string" ? args.name.trim() : "";
      const balance = Number(args.balance);
      if (!loanName) return errResult("name is required.");
      if (!Number.isFinite(balance) || balance < 0) return errResult("balance must be a non-negative number.");

      const payload: Record<string, unknown> = {
        user_id: userId,
        name: loanName,
        type: typeof args.type === "string" && args.type.trim() ? args.type.trim() : "personal",
        balance,
        original_amount: args.original_amount !== undefined ? Number(args.original_amount) : balance,
        interest_rate: Number(args.interest_rate ?? 0),
        monthly_payment: Number(args.monthly_payment ?? 0),
        deferral_months: Number(args.deferral_months ?? 0),
        deferral_type: args.deferral_type === "subsidized" ? "subsidized" : "unsubsidized",
        notes: typeof args.notes === "string" ? args.notes : null,
      };
      if (args.payment_day !== undefined) {
        const day = Number(args.payment_day);
        if (!Number.isInteger(day) || day < 1 || day > 31) {
          return errResult("payment_day must be an integer between 1 and 31.");
        }
        payload.payment_day = day;
      }

      const { data, error } = await admin
        .from("loans")
        .insert(payload)
        .select("id, name, type, balance, original_amount, interest_rate, monthly_payment, payment_day, deferral_months, deferral_type, notes")
        .single();
      if (error) return errResult(`Failed to create loan: ${error.message}`);
      return okResult({ created: true, loan: data });
    }

    case "update_loan": {
      const updates: Record<string, unknown> = {};
      if (typeof args.name === "string" && args.name.trim()) updates.name = args.name.trim();
      if (typeof args.type === "string" && args.type.trim()) updates.type = args.type.trim();
      for (const field of ["balance", "monthly_payment", "interest_rate", "original_amount"] as const) {
        if (args[field] !== undefined) {
          const val = Number(args[field]);
          if (!Number.isFinite(val) || val < 0) return errResult(`${field} must be a non-negative number.`);
          updates[field] = val;
        }
      }
      if (args.payment_day !== undefined) {
        const day = Number(args.payment_day);
        if (!Number.isInteger(day) || day < 1 || day > 31) {
          return errResult("payment_day must be an integer between 1 and 31.");
        }
        updates.payment_day = day;
      }
      if (args.deferral_months !== undefined) {
        const months = Number(args.deferral_months);
        if (!Number.isInteger(months) || months < 0) {
          return errResult("deferral_months must be a non-negative integer.");
        }
        updates.deferral_months = months;
      }
      if (args.deferral_type !== undefined) {
        if (args.deferral_type !== "subsidized" && args.deferral_type !== "unsubsidized") {
          return errResult("deferral_type must be 'subsidized' or 'unsubsidized'.");
        }
        updates.deferral_type = args.deferral_type;
      }
      if (args.notes !== undefined) updates.notes = typeof args.notes === "string" ? args.notes : null;
      if (Array.isArray(args.clear_fields)) {
        for (const field of args.clear_fields) {
          if (field === "original_amount" || field === "payment_day" || field === "notes") {
            updates[field] = null;
          }
        }
      }
      if (Object.keys(updates).length === 0) return errResult("Provide at least one field to update.");

      const { data: loans, error: fetchErr } = await admin
        .from("loans")
        .select("id, name, type, balance, original_amount, interest_rate, monthly_payment, payment_day, deferral_months, deferral_type, notes")
        .eq("user_id", userId);
      if (fetchErr) return errResult(`Database error: ${fetchErr.message}`);

      const resolved = resolveNamedEntity(
        loans ?? [],
        typeof args.loan_id === "string" ? args.loan_id : undefined,
        typeof args.loan_name === "string" ? args.loan_name : undefined,
        "loan"
      );
      if (!resolved.ok) return errResult(resolved.error);

      const target = resolved.match;
      const { data: updated, error: updateErr } = await admin
        .from("loans")
        .update(updates)
        .eq("id", target.id)
        .eq("user_id", userId)
        .select("id, name, type, balance, original_amount, interest_rate, monthly_payment, payment_day, deferral_months, deferral_type, notes, updated_at")
        .single();
      if (updateErr) return errResult(`Failed to update loan: ${updateErr.message}`);

      return okResult({
        updated: true,
        loan: updated,
        previous: {
          name: target.name,
          balance: Number(target.balance),
          monthly_payment: Number(target.monthly_payment),
          interest_rate: Number(target.interest_rate),
          payment_day: target.payment_day,
        },
      });
    }

    case "toggle_loan_paid": {
      if (typeof args.paid !== "boolean") return errResult("paid (boolean) is required.");
      const now = new Date();
      const defaultMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
      const month =
        typeof args.month === "string" && /^\d{4}-\d{2}$/.test(args.month)
          ? args.month
          : defaultMonth;

      const { data: loans, error: loanErr } = await admin
        .from("loans")
        .select("id, name")
        .eq("user_id", userId);
      if (loanErr) return errResult(`Database error: ${loanErr.message}`);

      const resolved = resolveNamedEntity(
        loans ?? [],
        typeof args.loan_id === "string" ? args.loan_id : undefined,
        typeof args.loan_name === "string" ? args.loan_name : undefined,
        "loan"
      );
      if (!resolved.ok) return errResult(resolved.error);

      const { data: existing } = await admin
        .from("planner_configs")
        .select("config, paid_loan_ids, paid_loan_month, dismissed_suggestions, tax_filing_status")
        .eq("user_id", userId)
        .maybeSingle();

      const existingConfig = (existing?.config ?? {}) as Record<string, unknown>;
      const existingUnpaid =
        existingConfig.loanUnpaidMonthOverrides && typeof existingConfig.loanUnpaidMonthOverrides === "object"
          ? (existingConfig.loanUnpaidMonthOverrides as Record<string, string>)
          : {};

      const nextState = applyLoanPaidStatus({
        loanId: resolved.match.id,
        paid: args.paid,
        month,
        currentPaidLoanIds: Array.isArray(existing?.paid_loan_ids) ? (existing.paid_loan_ids as string[]) : [],
        currentPaidLoanMonth: typeof existing?.paid_loan_month === "string" ? existing.paid_loan_month : "",
        currentUnpaidOverrides: existingUnpaid,
      });

      const nextConfig = {
        ...existingConfig,
        loanUnpaidMonthOverrides: nextState.loanUnpaidMonthOverrides,
      };

      const { error: saveErr } = await admin
        .from("planner_configs")
        .upsert(
          {
            user_id: userId,
            config: nextConfig,
            paid_loan_ids: nextState.paid_loan_ids,
            paid_loan_month: nextState.paid_loan_month,
            dismissed_suggestions: existing?.dismissed_suggestions ?? [],
            tax_filing_status: existing?.tax_filing_status ?? "single",
          },
          { onConflict: "user_id" }
        );
      if (saveErr) return errResult(`Failed to update loan paid status: ${saveErr.message}`);

      return okResult({
        updated: true,
        loan: resolved.match,
        month,
        paid: args.paid,
        paid_loan_ids: nextState.paid_loan_ids,
      });
    }

    case "delete_loan": {
      const { data: loans, error: fetchErr } = await admin
        .from("loans")
        .select("id, name, balance")
        .eq("user_id", userId);
      if (fetchErr) return errResult(`Database error: ${fetchErr.message}`);

      const resolved = resolveNamedEntity(
        loans ?? [],
        typeof args.loan_id === "string" ? args.loan_id : undefined,
        typeof args.loan_name === "string" ? args.loan_name : undefined,
        "loan"
      );
      if (!resolved.ok) return errResult(resolved.error);

      const { error: delErr } = await admin
        .from("loans")
        .delete()
        .eq("id", resolved.match.id)
        .eq("user_id", userId);
      if (delErr) return errResult(`Failed to delete loan: ${delErr.message}`);
      return okResult({ deleted: true, loan: resolved.match });
    }

    // ── Holdings CRUD ────────────────────────────────────────────────────────
    case "upsert_holding": {
      const ticker = typeof args.ticker === "string" ? args.ticker.trim().toUpperCase() : "";
      const shares = Number(args.shares);
      if (!/^[A-Z0-9.-]{1,12}$/.test(ticker)) {
        return errResult("ticker must be 1-12 uppercase letters, digits, dots, or hyphens.");
      }
      if (!Number.isFinite(shares) || shares <= 0) return errResult("shares must be > 0.");

      const { data: accounts, error: accErr } = await admin
        .from("accounts")
        .select("id, name, type")
        .eq("user_id", userId)
        .in("type", ["stock", "crypto"]);
      if (accErr) return errResult(`Database error: ${accErr.message}`);

      const resolved = resolveNamedEntity(
        accounts ?? [],
        typeof args.account_id === "string" ? args.account_id : undefined,
        typeof args.account_name === "string" ? args.account_name : undefined,
        "account"
      );
      if (!resolved.ok) return errResult(resolved.error);

      const payload: Record<string, unknown> = {
        user_id: userId,
        account_id: resolved.match.id,
        ticker,
        shares,
      };
      if (args.cost_basis !== undefined) {
        const cb = Number(args.cost_basis);
        if (!Number.isFinite(cb) || cb < 0) return errResult("cost_basis must be a non-negative number.");
        payload.cost_basis = cb;
      }

      const { data, error } = await admin
        .from("stock_holdings")
        .upsert(payload, { onConflict: "account_id,ticker" })
        .select("id, account_id, ticker, shares, cost_basis, updated_at")
        .single();
      if (error) return errResult(`Failed to save holding: ${error.message}`);
      return okResult({ saved: true, account: resolved.match.name, holding: data });
    }

    case "update_holding": {
      const holdingId = typeof args.holding_id === "string" ? args.holding_id.trim() : "";
      if (!holdingId) return errResult("holding_id is required.");

      const updates: Record<string, unknown> = {};
      if (typeof args.ticker === "string") {
        const ticker = args.ticker.trim().toUpperCase();
        if (!/^[A-Z0-9.-]{1,12}$/.test(ticker)) {
          return errResult("ticker must be 1-12 uppercase letters, digits, dots, or hyphens.");
        }
        updates.ticker = ticker;
      }
      if (args.shares !== undefined) {
        const shares = Number(args.shares);
        if (!Number.isFinite(shares) || shares <= 0) return errResult("shares must be > 0.");
        updates.shares = shares;
      }
      if (args.clear_cost_basis === true) {
        updates.cost_basis = null;
      } else if (args.cost_basis !== undefined) {
        const cb = Number(args.cost_basis);
        if (!Number.isFinite(cb) || cb < 0) return errResult("cost_basis must be a non-negative number.");
        updates.cost_basis = cb;
      }
      if (
        (typeof args.account_id === "string" && args.account_id.trim()) ||
        (typeof args.account_name === "string" && args.account_name.trim())
      ) {
        const { data: accounts, error: accErr } = await admin
          .from("accounts")
          .select("id, name, type")
          .eq("user_id", userId)
          .in("type", ["stock", "crypto"]);
        if (accErr) return errResult(`Database error: ${accErr.message}`);
        const resolved = resolveNamedEntity(
          accounts ?? [],
          typeof args.account_id === "string" ? args.account_id : undefined,
          typeof args.account_name === "string" ? args.account_name : undefined,
          "account"
        );
        if (!resolved.ok) return errResult(resolved.error);
        updates.account_id = resolved.match.id;
      }

      if (Object.keys(updates).length === 0) return errResult("Provide at least one field to update.");

      const { data, error } = await admin
        .from("stock_holdings")
        .update(updates)
        .eq("id", holdingId)
        .eq("user_id", userId)
        .select("id, account_id, ticker, shares, cost_basis, updated_at")
        .maybeSingle();
      if (error) return errResult(`Failed to update holding: ${error.message}`);
      if (!data) return errResult(`No holding found with id "${holdingId}".`);
      return okResult({ updated: true, holding: data });
    }

    case "delete_holding": {
      if (typeof args.holding_id === "string" && args.holding_id.trim()) {
        const { data, error } = await admin
          .from("stock_holdings")
          .delete()
          .eq("id", args.holding_id.trim())
          .eq("user_id", userId)
          .select("id, ticker, shares")
          .maybeSingle();
        if (error) return errResult(`Failed to delete holding: ${error.message}`);
        if (!data) return errResult(`No holding found with id "${args.holding_id}".`);
        return okResult({ deleted: true, holding: data });
      }

      const ticker = typeof args.ticker === "string" ? args.ticker.trim().toUpperCase() : "";
      if (!ticker) return errResult("Provide holding_id or ticker + account_name/account_id.");

      const { data: accounts } = await admin
        .from("accounts")
        .select("id, name")
        .eq("user_id", userId)
        .in("type", ["stock", "crypto"]);
      const resolved = resolveNamedEntity(
        accounts ?? [],
        typeof args.account_id === "string" ? args.account_id : undefined,
        typeof args.account_name === "string" ? args.account_name : undefined,
        "account"
      );
      if (!resolved.ok) return errResult(resolved.error);

      const { data, error } = await admin
        .from("stock_holdings")
        .delete()
        .eq("account_id", resolved.match.id)
        .eq("ticker", ticker)
        .eq("user_id", userId)
        .select("id, ticker, shares")
        .maybeSingle();
      if (error) return errResult(`Failed to delete holding: ${error.message}`);
      if (!data) return errResult(`No ${ticker} holding found in ${resolved.match.name}.`);
      return okResult({ deleted: true, account: resolved.match.name, holding: data });
    }

    // ── Transactions CRUD & Workflows ────────────────────────────────────────
    case "add_transaction": {
      const txnName = typeof args.name === "string" ? args.name.trim() : "";
      const merchantName =
        typeof args.merchant_name === "string" && args.merchant_name.trim()
          ? args.merchant_name.trim()
          : txnName;
      const amount = Number(args.amount);
      if (!txnName) return errResult("name is required.");
      if (!Number.isFinite(amount) || amount <= 0) return errResult("amount must be a positive number.");

      let category =
        typeof args.category === "string" && VALID_CATEGORIES.has(args.category) ? args.category : "other";
      let transactionType =
        typeof args.transaction_type === "string" && VALID_TRANSACTION_TYPES.has(args.transaction_type)
          ? args.transaction_type
          : "";

      // Apply saved merchant_category_rules if category was omitted or "other" (matches UI).
      if (!args.category || category === "other") {
        const merchantKey = normalizeMerchantKey(merchantName || txnName);
        if (merchantKey) {
          const { data: rule } = await admin
            .from("merchant_category_rules")
            .select("category, transaction_type")
            .eq("user_id", userId)
            .eq("merchant_key", merchantKey)
            .maybeSingle();
          if (rule) {
            category = rule.category;
            if (!transactionType) transactionType = rule.transaction_type;
          }
        }
      }
      if (!transactionType) {
        transactionType = defaultTransactionTypeForCategory(category);
      }

      const date =
        typeof args.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.date)
          ? args.date
          : new Date().toISOString().slice(0, 10);

      let accountId: string | null = null;
      let creditCardId: string | null = null;

      if (
        (typeof args.account_id === "string" && args.account_id.trim()) ||
        (typeof args.account_name === "string" && args.account_name.trim())
      ) {
        const { data: accounts } = await admin.from("accounts").select("id, name").eq("user_id", userId);
        const res = resolveNamedEntity(
          accounts ?? [],
          typeof args.account_id === "string" ? args.account_id : undefined,
          typeof args.account_name === "string" ? args.account_name : undefined,
          "account"
        );
        if (!res.ok) return errResult(res.error);
        accountId = res.match.id;
      } else if (
        (typeof args.credit_card_id === "string" && args.credit_card_id.trim()) ||
        (typeof args.card_name === "string" && args.card_name.trim())
      ) {
        const { data: cards } = await admin.from("credit_cards").select("id, name").eq("user_id", userId);
        const res = resolveNamedEntity(
          cards ?? [],
          typeof args.credit_card_id === "string" ? args.credit_card_id : undefined,
          typeof args.card_name === "string" ? args.card_name : undefined,
          "card"
        );
        if (!res.ok) return errResult(res.error);
        creditCardId = res.match.id;
      }

      const { data: inserted, error: insertErr } = await admin
        .from("transactions")
        .insert({
          user_id: userId,
          account_id: accountId,
          credit_card_id: creditCardId,
          name: txnName,
          merchant_name: merchantName,
          amount: toSignedAmount(amount, transactionType),
          date,
          category,
          subcategory: typeof args.subcategory === "string" && args.subcategory.trim() ? args.subcategory.trim() : null,
          transaction_type: transactionType,
          is_manual: true,
          is_ignored: args.is_ignored === true,
          notes: typeof args.notes === "string" && args.notes.length > 0 ? args.notes : null,
        })
        .select("id, date, name, merchant_name, amount, category, subcategory, transaction_type, is_ignored, notes, account_id, credit_card_id")
        .single();
      if (insertErr) return errResult(`Failed to add transaction: ${insertErr.message}`);
      return okResult({ created: true, transaction: inserted });
    }

    case "update_transaction": {
      const txnId = typeof args.transaction_id === "string" ? args.transaction_id.trim() : "";
      if (!txnId) return errResult("transaction_id is required.");

      const updates: Record<string, unknown> = {};
      if (typeof args.name === "string" && args.name.trim()) updates.name = args.name.trim();
      if (args.merchant_name !== undefined) {
        updates.merchant_name =
          typeof args.merchant_name === "string" && args.merchant_name.trim() ? args.merchant_name.trim() : null;
      } else if (updates.name !== undefined) {
        updates.merchant_name = updates.name;
      }
      if (args.amount !== undefined) {
        const val = Number(args.amount);
        if (!Number.isFinite(val)) return errResult("amount must be a valid number.");
        updates.amount = val;
      }
      if (typeof args.date === "string") {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) return errResult("date must be YYYY-MM-DD.");
        updates.date = args.date;
      }
      if (typeof args.category === "string") {
        if (!VALID_CATEGORIES.has(args.category)) return errResult(`Invalid category "${args.category}".`);
        updates.category = args.category;
      }
      if (args.subcategory !== undefined) {
        updates.subcategory =
          typeof args.subcategory === "string" && args.subcategory.trim() ? args.subcategory.trim() : null;
      }
      if (typeof args.transaction_type === "string") {
        if (!VALID_TRANSACTION_TYPES.has(args.transaction_type)) {
          return errResult("transaction_type must be expense, income, or transfer.");
        }
        updates.transaction_type = args.transaction_type;
      }
      if (args.clear_source === true) {
        updates.account_id = null;
        updates.credit_card_id = null;
      } else if (
        (typeof args.account_id === "string" && args.account_id.trim()) ||
        (typeof args.account_name === "string" && args.account_name.trim())
      ) {
        const { data: accounts } = await admin.from("accounts").select("id, name").eq("user_id", userId);
        const res = resolveNamedEntity(
          accounts ?? [],
          typeof args.account_id === "string" ? args.account_id : undefined,
          typeof args.account_name === "string" ? args.account_name : undefined,
          "account"
        );
        if (!res.ok) return errResult(res.error);
        updates.account_id = res.match.id;
        updates.credit_card_id = null;
      } else if (
        (typeof args.credit_card_id === "string" && args.credit_card_id.trim()) ||
        (typeof args.card_name === "string" && args.card_name.trim())
      ) {
        const { data: cards } = await admin.from("credit_cards").select("id, name").eq("user_id", userId);
        const res = resolveNamedEntity(
          cards ?? [],
          typeof args.credit_card_id === "string" ? args.credit_card_id : undefined,
          typeof args.card_name === "string" ? args.card_name : undefined,
          "card"
        );
        if (!res.ok) return errResult(res.error);
        updates.credit_card_id = res.match.id;
        updates.account_id = null;
      }
      if (typeof args.is_ignored === "boolean") updates.is_ignored = args.is_ignored;
      if (args.notes !== undefined) {
        updates.notes = typeof args.notes === "string" && args.notes.length > 0 ? args.notes : null;
      }
      if (Object.keys(updates).length === 0) return errResult("Provide at least one field to update.");

      const { data: updated, error } = await admin
        .from("transactions")
        .update(updates)
        .eq("id", txnId)
        .eq("user_id", userId)
        .select("id, date, name, merchant_name, amount, category, subcategory, transaction_type, is_ignored, notes, account_id, credit_card_id")
        .maybeSingle();
      if (error) return errResult(`Failed to update transaction: ${error.message}`);
      if (!updated) return errResult(`No transaction found with id "${txnId}".`);

      let merchantRuleSaved = false;
      if (typeof updates.category === "string" && args.remember_merchant_category !== false) {
        const merchantKey = normalizeMerchantKey(updated.merchant_name || updated.name);
        if (merchantKey) {
          const ruleType =
            typeof updates.transaction_type === "string"
              ? updates.transaction_type
              : defaultTransactionTypeForCategory(updates.category);
          const { error: ruleError } = await admin
            .from("merchant_category_rules")
            .upsert(
              {
                user_id: userId,
                merchant_key: merchantKey,
                category: updates.category,
                transaction_type: ruleType,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "user_id,merchant_key" }
            );
          if (ruleError) return errResult(`Updated transaction, but failed to save merchant rule: ${ruleError.message}`);
          merchantRuleSaved = true;
        }
      }

      return okResult({ updated: true, transaction: updated, merchant_rule_saved: merchantRuleSaved });
    }

    case "bulk_update_transactions": {
      const ids = Array.isArray(args.transaction_ids)
        ? [...new Set(args.transaction_ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0).map((id) => id.trim()))]
        : [];
      if (ids.length === 0) return errResult("Provide at least one transaction_id.");
      if (ids.length > 200) return errResult("Maximum 200 transaction_ids per bulk update.");

      const updates: Record<string, unknown> = {};
      if (typeof args.category === "string") {
        if (!VALID_CATEGORIES.has(args.category)) return errResult(`Invalid category "${args.category}".`);
        updates.category = args.category;
      }
      if (typeof args.transaction_type === "string") {
        if (!VALID_TRANSACTION_TYPES.has(args.transaction_type)) {
          return errResult("transaction_type must be expense, income, or transfer.");
        }
        updates.transaction_type = args.transaction_type;
      }
      if (typeof args.is_ignored === "boolean") updates.is_ignored = args.is_ignored;
      if (args.notes !== undefined) {
        updates.notes = typeof args.notes === "string" && args.notes.length > 0 ? args.notes : null;
      }
      if (
        (typeof args.account_id === "string" && args.account_id.trim()) ||
        (typeof args.account_name === "string" && args.account_name.trim())
      ) {
        const { data: accounts } = await admin.from("accounts").select("id, name").eq("user_id", userId);
        const res = resolveNamedEntity(
          accounts ?? [],
          typeof args.account_id === "string" ? args.account_id : undefined,
          typeof args.account_name === "string" ? args.account_name : undefined,
          "account"
        );
        if (!res.ok) return errResult(res.error);
        updates.account_id = res.match.id;
        updates.credit_card_id = null;
      } else if (
        (typeof args.credit_card_id === "string" && args.credit_card_id.trim()) ||
        (typeof args.card_name === "string" && args.card_name.trim())
      ) {
        const { data: cards } = await admin.from("credit_cards").select("id, name").eq("user_id", userId);
        const res = resolveNamedEntity(
          cards ?? [],
          typeof args.credit_card_id === "string" ? args.credit_card_id : undefined,
          typeof args.card_name === "string" ? args.card_name : undefined,
          "card"
        );
        if (!res.ok) return errResult(res.error);
        updates.credit_card_id = res.match.id;
        updates.account_id = null;
      }
      if (Object.keys(updates).length === 0) return errResult("Provide at least one field to update.");

      const { data: updatedRows, error } = await admin
        .from("transactions")
        .update(updates)
        .in("id", ids)
        .eq("user_id", userId)
        .select("id, date, name, merchant_name, amount, category, transaction_type, is_ignored, notes");
      if (error) return errResult(`Failed to bulk update transactions: ${error.message}`);

      let rulesSaved = 0;
      if (typeof updates.category === "string" && args.remember_merchant_category === true) {
        const keys = [...new Set((updatedRows ?? []).map((r) => normalizeMerchantKey(r.merchant_name || r.name)).filter((k): k is string => Boolean(k)))];
        if (keys.length > 0) {
          const ruleType =
            typeof updates.transaction_type === "string"
              ? updates.transaction_type
              : defaultTransactionTypeForCategory(updates.category);
          const nowIso = new Date().toISOString();
          const { error: ruleErr } = await admin
            .from("merchant_category_rules")
            .upsert(
              keys.map((merchant_key) => ({
                user_id: userId,
                merchant_key,
                category: updates.category,
                transaction_type: ruleType,
                updated_at: nowIso,
              })),
              { onConflict: "user_id,merchant_key" }
            );
          if (ruleErr) return errResult(`Updated transactions, but failed to save merchant rules: ${ruleErr.message}`);
          rulesSaved = keys.length;
        }
      }

      return okResult({
        updated_count: updatedRows?.length ?? 0,
        merchant_rules_saved: rulesSaved,
        transactions: updatedRows ?? [],
      });
    }

    case "import_transactions": {
      const rawRows = Array.isArray(args.transactions) ? (args.transactions as Array<Record<string, unknown>>) : [];
      if (rawRows.length === 0) return errResult("transactions array must contain at least one row.");
      if (rawRows.length > 500) return errResult("Maximum 500 transactions per import call.");

      let defaultAccountId: string | null = null;
      let defaultCardId: string | null = null;
      let sourceName: string | null = null;

      if (
        (typeof args.account_id === "string" && args.account_id.trim()) ||
        (typeof args.account_name === "string" && args.account_name.trim())
      ) {
        const { data: accounts } = await admin.from("accounts").select("id, name").eq("user_id", userId);
        const res = resolveNamedEntity(
          accounts ?? [],
          typeof args.account_id === "string" ? args.account_id : undefined,
          typeof args.account_name === "string" ? args.account_name : undefined,
          "account"
        );
        if (!res.ok) return errResult(res.error);
        defaultAccountId = res.match.id;
        sourceName = res.match.name;
      } else if (
        (typeof args.credit_card_id === "string" && args.credit_card_id.trim()) ||
        (typeof args.card_name === "string" && args.card_name.trim())
      ) {
        const { data: cards } = await admin.from("credit_cards").select("id, name").eq("user_id", userId);
        const res = resolveNamedEntity(
          cards ?? [],
          typeof args.credit_card_id === "string" ? args.credit_card_id : undefined,
          typeof args.card_name === "string" ? args.card_name : undefined,
          "card"
        );
        if (!res.ok) return errResult(res.error);
        defaultCardId = res.match.id;
        sourceName = res.match.name;
      }

      const merchantKeys = [
        ...new Set(
          rawRows
            .map((r) => normalizeMerchantKey(typeof r.merchant_name === "string" ? r.merchant_name : (typeof r.name === "string" ? r.name : "")))
            .filter((k): k is string => Boolean(k))
        ),
      ];
      const ruleMap = new Map<string, { category: string; transaction_type: string }>();
      if (merchantKeys.length > 0) {
        const { data: rules } = await admin
          .from("merchant_category_rules")
          .select("merchant_key, category, transaction_type")
          .eq("user_id", userId)
          .in("merchant_key", merchantKeys);
        for (const rule of rules ?? []) {
          ruleMap.set(rule.merchant_key, { category: rule.category, transaction_type: rule.transaction_type });
        }
      }

      const occurrenceCounts = new Map<string, number>();
      const payload = [];
      for (let i = 0; i < rawRows.length; i++) {
        const row = rawRows[i];
        const date = typeof row.date === "string" ? row.date.trim() : "";
        const name = typeof row.name === "string" ? row.name.trim() : "";
        const amount = Number(row.amount);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return errResult(`Row ${i}: date must be YYYY-MM-DD.`);
        if (!name) return errResult(`Row ${i}: name is required.`);
        if (!Number.isFinite(amount) || amount === 0) return errResult(`Row ${i}: amount must be a non-zero number.`);

        const merchantName =
          typeof row.merchant_name === "string" && row.merchant_name.trim() ? row.merchant_name.trim() : name;
        const mKey = normalizeMerchantKey(merchantName);
        const savedRule = mKey ? ruleMap.get(mKey) : undefined;

        let category =
          typeof row.category === "string" && VALID_CATEGORIES.has(row.category)
            ? row.category
            : (savedRule?.category ?? "other");
        if (row.category === "other" && savedRule) category = savedRule.category;

        const txType =
          typeof row.transaction_type === "string" && VALID_TRANSACTION_TYPES.has(row.transaction_type)
            ? row.transaction_type
            : (savedRule?.transaction_type ?? defaultTransactionTypeForCategory(category));

        const signedAmount = toSignedAmount(amount, txType);
        const baseKey = `${defaultAccountId ?? defaultCardId ?? "manual"}|${date}|${signedAmount.toFixed(2)}|${mKey ?? name}`;
        const occ = (occurrenceCounts.get(baseKey) ?? 0) + 1;
        occurrenceCounts.set(baseKey, occ);

        const fingerprint =
          typeof row.import_fingerprint === "string" && row.import_fingerprint.trim()
            ? row.import_fingerprint.trim()
            : buildImportFingerprint({
                sourceKey: defaultAccountId ?? defaultCardId ?? "manual",
                date,
                amount: signedAmount,
                name: merchantName,
                occurrence: occ,
              });

        payload.push({
          user_id: userId,
          account_id: defaultAccountId,
          credit_card_id: defaultCardId,
          source_name: sourceName,
          date,
          name,
          merchant_name: merchantName,
          amount: signedAmount,
          category,
          transaction_type: txType,
          is_manual: true,
          import_fingerprint: fingerprint,
          notes: typeof row.notes === "string" && row.notes.length > 0 ? row.notes : null,
        });
      }

      const { data: inserted, error } = await admin
        .from("transactions")
        .upsert(payload, { onConflict: "user_id,import_fingerprint", ignoreDuplicates: true })
        .select("id, date, name, merchant_name, amount, category, transaction_type, account_id, credit_card_id");
      if (error) return errResult(`Failed to import transactions: ${error.message}`);

      return okResult({
        submitted: payload.length,
        imported: inserted?.length ?? 0,
        duplicates_skipped: payload.length - (inserted?.length ?? 0),
        transactions: inserted ?? [],
      });
    }

    case "delete_transaction": {
      const txnId = typeof args.transaction_id === "string" ? args.transaction_id.trim() : "";
      if (!txnId) return errResult("transaction_id is required.");

      const { data, error } = await admin
        .from("transactions")
        .delete()
        .eq("id", txnId)
        .eq("user_id", userId)
        .select("id, date, name, amount")
        .maybeSingle();
      if (error) return errResult(`Failed to delete transaction: ${error.message}`);
      if (!data) return errResult(`No transaction found with id "${txnId}".`);
      return okResult({ deleted: true, transaction: data });
    }

    case "delete_transactions_for_source": {
      const sourceType = typeof args.source_type === "string" ? args.source_type : "";
      if (sourceType === "teller") {
        const { error, count } = await admin
          .from("transactions")
          .delete({ count: "exact" })
          .eq("user_id", userId)
          .not("teller_transaction_id", "is", null);
        if (error) return errResult(`Failed to delete Teller transactions: ${error.message}`);
        return okResult({ deleted: true, source_type: "teller", deleted_count: count ?? 0 });
      }
      if (sourceType === "account") {
        const { data: accounts } = await admin.from("accounts").select("id, name").eq("user_id", userId);
        const res = resolveNamedEntity(
          accounts ?? [],
          typeof args.account_id === "string" ? args.account_id : undefined,
          typeof args.account_name === "string" ? args.account_name : undefined,
          "account"
        );
        if (!res.ok) return errResult(res.error);
        const { error, count } = await admin
          .from("transactions")
          .delete({ count: "exact" })
          .eq("user_id", userId)
          .eq("account_id", res.match.id);
        if (error) return errResult(`Failed to delete account transactions: ${error.message}`);
        return okResult({ deleted: true, source_type: "account", account: res.match, deleted_count: count ?? 0 });
      }
      if (sourceType === "card") {
        const { data: cards } = await admin.from("credit_cards").select("id, name").eq("user_id", userId);
        const res = resolveNamedEntity(
          cards ?? [],
          typeof args.card_id === "string" ? args.card_id : undefined,
          typeof args.card_name === "string" ? args.card_name : undefined,
          "card"
        );
        if (!res.ok) return errResult(res.error);
        const { error, count } = await admin
          .from("transactions")
          .delete({ count: "exact" })
          .eq("user_id", userId)
          .eq("credit_card_id", res.match.id);
        if (error) return errResult(`Failed to delete card transactions: ${error.message}`);
        return okResult({ deleted: true, source_type: "card", creditCard: res.match, deleted_count: count ?? 0 });
      }
      return errResult("source_type must be 'account', 'card', or 'teller'.");
    }

    case "get_transaction_coverage": {
      const year = args.year !== undefined ? Number(args.year) : new Date().getUTCFullYear();
      if (!Number.isInteger(year) || year < 2000 || year > 2100) {
        return errResult("year must be an integer between 2000 and 2100.");
      }

      let sourceColumn: "account_id" | "credit_card_id" | null = null;
      let sourceId: string | null = null;
      let sourceLabel: string | null = null;

      if (
        (typeof args.account_id === "string" && args.account_id.trim()) ||
        (typeof args.account_name === "string" && args.account_name.trim())
      ) {
        const { data: accounts } = await admin.from("accounts").select("id, name").eq("user_id", userId);
        const res = resolveNamedEntity(
          accounts ?? [],
          typeof args.account_id === "string" ? args.account_id : undefined,
          typeof args.account_name === "string" ? args.account_name : undefined,
          "account"
        );
        if (!res.ok) return errResult(res.error);
        sourceColumn = "account_id";
        sourceId = res.match.id;
        sourceLabel = res.match.name;
      } else if (
        (typeof args.card_id === "string" && args.card_id.trim()) ||
        (typeof args.card_name === "string" && args.card_name.trim())
      ) {
        const { data: cards } = await admin.from("credit_cards").select("id, name").eq("user_id", userId);
        const res = resolveNamedEntity(
          cards ?? [],
          typeof args.card_id === "string" ? args.card_id : undefined,
          typeof args.card_name === "string" ? args.card_name : undefined,
          "card"
        );
        if (!res.ok) return errResult(res.error);
        sourceColumn = "credit_card_id";
        sourceId = res.match.id;
        sourceLabel = res.match.name;
      }

      const monthCounts: Record<number, number> = {};
      const pageSize = 1000;
      let offset = 0;
      let totalImportedInYear = 0;

      while (true) {
        let q = admin
          .from("transactions")
          .select("id, date")
          .eq("user_id", userId)
          .not("import_fingerprint", "is", null)
          .gte("date", `${year}-01-01`)
          .lt("date", `${year + 1}-01-01`)
          .order("date", { ascending: true })
          .order("id", { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (sourceColumn && sourceId) q = q.eq(sourceColumn, sourceId);
        const { data, error } = await q;
        if (error) return errResult(`Database error: ${error.message}`);
        for (const row of data ?? []) {
          const m = Number(String(row.date).slice(5, 7));
          if (m >= 1 && m <= 12) {
            monthCounts[m] = (monthCounts[m] ?? 0) + 1;
            totalImportedInYear += 1;
          }
        }
        if ((data?.length ?? 0) < pageSize) break;
        offset += pageSize;
      }

      return okResult({
        year,
        source: sourceLabel ? { type: sourceColumn === "account_id" ? "account" : "card", id: sourceId, name: sourceLabel } : "all",
        total_imported_in_year: totalImportedInYear,
        month_counts: monthCounts,
      });
    }

    case "split_transaction": {
      const txnId = typeof args.transaction_id === "string" ? args.transaction_id.trim() : "";
      if (!txnId) return errResult("transaction_id is required.");

      const partA = args.part_a && typeof args.part_a === "object" ? (args.part_a as Record<string, unknown>) : null;
      const partB = args.part_b && typeof args.part_b === "object" ? (args.part_b as Record<string, unknown>) : null;
      if (!partA || !partB) return errResult("part_a and part_b objects are required.");

      const amountA = Number(partA.amount);
      const amountB = Number(partB.amount);
      if (!Number.isFinite(amountA) || amountA <= 0) return errResult("part_a.amount must be a positive number.");
      if (!Number.isFinite(amountB) || amountB <= 0) return errResult("part_b.amount must be a positive number.");

      const { data: original, error: fetchErr } = await admin
        .from("transactions")
        .select(
          "id, date, name, merchant_name, amount, category, transaction_type, is_manual, is_ignored, notes, account_id, credit_card_id, source_name, import_fingerprint, plaid_transaction_id, teller_transaction_id"
        )
        .eq("id", txnId)
        .eq("user_id", userId)
        .maybeSingle();
      if (fetchErr) return errResult(`Database error: ${fetchErr.message}`);
      if (!original) return errResult(`No transaction found with id "${txnId}".`);

      const categoryA = partA.category !== undefined ? String(partA.category) : (original.category || "other");
      const categoryB = partB.category !== undefined ? String(partB.category) : (original.category || "other");
      if (!VALID_CATEGORIES.has(categoryA)) return errResult(`Invalid part_a.category "${categoryA}".`);
      if (!VALID_CATEGORIES.has(categoryB)) return errResult(`Invalid part_b.category "${categoryB}".`);

      const typeA = partA.transaction_type !== undefined ? String(partA.transaction_type) : (original.transaction_type || "expense");
      const typeB = partB.transaction_type !== undefined ? String(partB.transaction_type) : (original.transaction_type || "expense");
      if (!VALID_TRANSACTION_TYPES.has(typeA)) return errResult(`Invalid part_a.transaction_type "${typeA}".`);
      if (!VALID_TRANSACTION_TYPES.has(typeB)) return errResult(`Invalid part_b.transaction_type "${typeB}".`);

      const defaults = defaultSplitNames(original.merchant_name || original.name || "Transaction");
      const nameA = typeof partA.name === "string" && partA.name.trim() ? partA.name.trim() : defaults.yourPart;
      const nameB = typeof partB.name === "string" && partB.name.trim() ? partB.name.trim() : defaults.otherPart;

      const base = {
        user_id: userId,
        account_id: original.account_id ?? null,
        credit_card_id: original.credit_card_id ?? null,
        source_name: original.source_name ?? null,
        date: original.date,
        is_manual: true,
      };

      // Insert replacement transactions first so a failed insert never hides/deletes the original.
      const { data: createdRows, error: insertErr } = await admin
        .from("transactions")
        .insert([
          {
            ...base,
            name: nameA,
            merchant_name: nameA,
            amount: toSignedAmount(amountA, typeA),
            category: categoryA,
            transaction_type: typeA,
          },
          {
            ...base,
            name: nameB,
            merchant_name: nameB,
            amount: toSignedAmount(amountB, typeB),
            category: categoryB,
            transaction_type: typeB,
          },
        ])
        .select("id, date, name, merchant_name, amount, category, transaction_type, account_id, credit_card_id");
      if (insertErr) return errResult(`Failed to create split transactions: ${insertErr.message}`);

      if (canDeleteSplitOriginal(original)) {
        const { error: delErr } = await admin
          .from("transactions")
          .delete()
          .eq("id", txnId)
          .eq("user_id", userId);
        if (delErr) return errResult(`Created split rows, but failed to delete original: ${delErr.message}`);
        return okResult({
          split: true,
          original_id: txnId,
          original_action: "deleted",
          created_transactions: createdRows ?? [],
        });
      }

      const { error: updateErr } = await admin
        .from("transactions")
        .update({ is_ignored: true, notes: appendSplitTag(original.notes) })
        .eq("id", txnId)
        .eq("user_id", userId);
      if (updateErr) return errResult(`Created split rows, but failed to ignore original: ${updateErr.message}`);

      return okResult({
        split: true,
        original_id: txnId,
        original_action: "ignored_with_split_tag",
        created_transactions: createdRows ?? [],
      });
    }

    case "find_refund_candidates": {
      const txnId = typeof args.transaction_id === "string" ? args.transaction_id.trim() : "";
      if (!txnId) return errResult("transaction_id is required.");

      const windowDays = Math.min(365, Math.max(1, Number(args.window_days ?? 90)));
      const limit = Math.min(50, Math.max(1, Number(args.limit ?? 20)));

      const { data: target, error: targetErr } = await admin
        .from("transactions")
        .select("id, date, name, merchant_name, amount, category, transaction_type, is_ignored, notes")
        .eq("id", txnId)
        .eq("user_id", userId)
        .maybeSingle();
      if (targetErr) return errResult(`Database error: ${targetErr.message}`);
      if (!target) return errResult(`No transaction found with id "${txnId}".`);

      const baseMs = Date.parse(`${String(target.date).slice(0, 10)}T00:00:00Z`);
      if (Number.isNaN(baseMs)) return errResult(`Transaction "${txnId}" has an invalid date.`);
      const start = new Date(baseMs - windowDays * 86_400_000).toISOString().slice(0, 10);
      const end = new Date(baseMs + windowDays * 86_400_000).toISOString().slice(0, 10);

      const { data: pool, error: poolErr } = await admin
        .from("transactions")
        .select("id, date, name, merchant_name, amount, category, transaction_type, is_ignored, notes, account_id, credit_card_id")
        .eq("user_id", userId)
        .eq("is_ignored", false)
        .neq("id", target.id)
        .gte("date", start)
        .lte("date", end)
        .order("date", { ascending: false })
        .limit(200);
      if (poolErr) return errResult(`Database error: ${poolErr.message}`);

      const ranked = rankRefundCandidates(target, pool ?? []).slice(0, limit);
      return okResult({ target, window_days: windowDays, count: ranked.length, candidates: ranked });
    }

    case "link_refund_transactions": {
      const txAId = typeof args.transaction_a_id === "string" ? args.transaction_a_id.trim() : "";
      const txBId = typeof args.transaction_b_id === "string" ? args.transaction_b_id.trim() : "";
      if (!txAId || !txBId) return errResult("Both transaction_a_id and transaction_b_id are required.");
      if (txAId === txBId) return errResult("Cannot link a transaction to itself.");

      const { data: rows, error: fetchErr } = await admin
        .from("transactions")
        .select("id, date, name, merchant_name, amount, category, transaction_type, is_ignored, notes, account_id, credit_card_id, source_name")
        .in("id", [txAId, txBId])
        .eq("user_id", userId);
      if (fetchErr) return errResult(`Database error: ${fetchErr.message}`);

      const txA = (rows ?? []).find((r) => r.id === txAId);
      const txB = (rows ?? []).find((r) => r.id === txBId);
      if (!txA || !txB) return errResult("Could not find both transactions to link.");

      const { original, refund } = classifyRefundPair(txA, txB);
      const origLabel = original.merchant_name || original.name;
      const refundLabel = refund.merchant_name || refund.name;

      const originalNotes = attachRefundTag(original.notes, {
        role: "original",
        partnerId: refund.id,
        partnerDate: refund.date,
        partnerName: refundLabel,
      });
      const refundNotes = attachRefundTag(refund.notes, {
        role: "refund",
        partnerId: original.id,
        partnerDate: original.date,
        partnerName: origLabel,
      });

      // Optionally create a net transaction for partial refunds before ignoring both.
      let netTransaction = null;
      const diff = Math.round((Math.abs(Number(original.amount)) - Math.abs(Number(refund.amount))) * 100) / 100;
      if (args.create_net_difference === true && diff >= 0.01) {
        const netName = `${origLabel} (after refund)`;
        const { data: inserted, error: insertErr } = await admin
          .from("transactions")
          .insert({
            user_id: userId,
            account_id: original.account_id ?? null,
            credit_card_id: original.credit_card_id ?? null,
            source_name: original.source_name ?? null,
            date: original.date,
            name: netName,
            merchant_name: netName,
            amount: toSignedAmount(diff, original.transaction_type),
            category: original.category,
            transaction_type: original.transaction_type,
            is_manual: true,
            notes: `Net amount after partial refund (${refund.date})`,
          })
          .select("id, date, name, merchant_name, amount, category, transaction_type, notes, account_id, credit_card_id")
          .single();
        if (insertErr) return errResult(`Failed to create net partial-refund transaction: ${insertErr.message}`);
        netTransaction = inserted;
      }

      const [{ data: updatedOrig, error: err1 }, { data: updatedRefund, error: err2 }] = await Promise.all([
        admin
          .from("transactions")
          .update({ is_ignored: true, notes: originalNotes })
          .eq("id", original.id)
          .eq("user_id", userId)
          .select("id, date, name, merchant_name, amount, category, transaction_type, is_ignored, notes")
          .single(),
        admin
          .from("transactions")
          .update({ is_ignored: true, notes: refundNotes })
          .eq("id", refund.id)
          .eq("user_id", userId)
          .select("id, date, name, merchant_name, amount, category, transaction_type, is_ignored, notes")
          .single(),
      ]);
      if (err1) return errResult(`Failed to update original transaction: ${err1.message}`);
      if (err2) return errResult(`Failed to update refund transaction: ${err2.message}`);

      return okResult({
        linked: true,
        original: updatedOrig,
        refund: updatedRefund,
        net_transaction: netTransaction,
      });
    }

    case "unlink_refund_transactions": {
      const txnId = typeof args.transaction_id === "string" ? args.transaction_id.trim() : "";
      if (!txnId) return errResult("transaction_id is required.");

      const { data: tx, error: fetchErr } = await admin
        .from("transactions")
        .select("id, notes")
        .eq("id", txnId)
        .eq("user_id", userId)
        .maybeSingle();
      if (fetchErr) return errResult(`Database error: ${fetchErr.message}`);
      if (!tx) return errResult(`No transaction found with id "${txnId}".`);

      const link = parseRefundLink(tx.notes);
      const ids = link ? [tx.id, link.partnerId] : [tx.id];

      const { data: rows, error: pairErr } = await admin
        .from("transactions")
        .select("id, notes")
        .in("id", ids)
        .eq("user_id", userId);
      if (pairErr) return errResult(`Database error: ${pairErr.message}`);

      const updated = [];
      for (const row of rows ?? []) {
        const cleaned = removeRefundTag(row.notes);
        const { data: saved, error: updateErr } = await admin
          .from("transactions")
          .update({ is_ignored: false, notes: cleaned })
          .eq("id", row.id)
          .eq("user_id", userId)
          .select("id, date, name, merchant_name, amount, category, transaction_type, is_ignored, notes")
          .single();
        if (updateErr) return errResult(`Failed to unlink transaction ${row.id}: ${updateErr.message}`);
        updated.push(saved);
      }

      return okResult({ unlinked: true, updated });
    }

    // ── Planner Config ───────────────────────────────────────────────────────
    case "update_planner_config": {
      const { data: existing } = await admin
        .from("planner_configs")
        .select("config, paid_loan_ids, paid_loan_month, dismissed_suggestions, tax_filing_status")
        .eq("user_id", userId)
        .maybeSingle();

      const nextConfig =
        args.config_patch && typeof args.config_patch === "object"
          ? { ...(existing?.config ?? {}), ...(args.config_patch as Record<string, unknown>) }
          : (existing?.config ?? {});

      const payload: Record<string, unknown> = {
        user_id: userId,
        config: nextConfig,
        paid_loan_ids: Array.isArray(args.paid_loan_ids) ? args.paid_loan_ids : (existing?.paid_loan_ids ?? []),
        paid_loan_month: typeof args.paid_loan_month === "string" ? args.paid_loan_month : (existing?.paid_loan_month ?? ""),
        dismissed_suggestions: Array.isArray(args.dismissed_suggestions)
          ? args.dismissed_suggestions
          : (existing?.dismissed_suggestions ?? []),
        tax_filing_status:
          typeof args.tax_filing_status === "string" ? args.tax_filing_status : (existing?.tax_filing_status ?? "single"),
      };

      const { data, error } = await admin
        .from("planner_configs")
        .upsert(payload, { onConflict: "user_id" })
        .select("config, paid_loan_ids, paid_loan_month, dismissed_suggestions, tax_filing_status, updated_at")
        .single();
      if (error) return errResult(`Failed to update planner config: ${error.message}`);
      return okResult({ updated: true, plannerConfig: data });
    }

    case "manage_planner_item": {
      const collection = typeof args.collection === "string" ? args.collection : "";
      const action = typeof args.action === "string" ? args.action : "";
      if (!PLANNER_COLLECTIONS.has(collection)) {
        return errResult(`Invalid collection "${collection}".`);
      }
      if (action !== "upsert" && action !== "delete") {
        return errResult("action must be 'upsert' or 'delete'.");
      }

      const { data: existing, error: fetchErr } = await admin
        .from("planner_configs")
        .select("config, paid_loan_ids, paid_loan_month, dismissed_suggestions, tax_filing_status")
        .eq("user_id", userId)
        .maybeSingle();
      if (fetchErr) return errResult(`Database error: ${fetchErr.message}`);

      const existingConfig = (existing?.config ?? {}) as Record<string, unknown>;
      const currentList = existingConfig[collection];

      if (action === "delete") {
        const itemId = typeof args.item_id === "string" ? args.item_id.trim() : "";
        if (!itemId) return errResult("item_id is required when action='delete'.");
        const { items, deleted } = deletePlannerCollectionItem(currentList, itemId);
        if (!deleted) return errResult(`No item with id "${itemId}" found in ${collection}.`);

        const nextConfig = { ...existingConfig, [collection]: items };
        const { error: saveErr } = await admin
          .from("planner_configs")
          .upsert(
            {
              user_id: userId,
              config: nextConfig,
              paid_loan_ids: existing?.paid_loan_ids ?? [],
              paid_loan_month: existing?.paid_loan_month ?? "",
              dismissed_suggestions: existing?.dismissed_suggestions ?? [],
              tax_filing_status: existing?.tax_filing_status ?? "single",
            },
            { onConflict: "user_id" }
          );
        if (saveErr) return errResult(`Failed to save planner config: ${saveErr.message}`);
        return okResult({ deleted: true, collection, item: deleted, count: items.length });
      }

      const itemObj = args.item && typeof args.item === "object" ? { ...(args.item as Record<string, unknown>) } : null;
      if (!itemObj) return errResult("item object is required when action='upsert'.");
      if (!itemObj.id && typeof args.item_id === "string" && args.item_id.trim()) {
        itemObj.id = args.item_id.trim();
      }

      const { items, saved, action: op } = upsertPlannerCollectionItem(currentList, itemObj);
      const nextConfig = { ...existingConfig, [collection]: items };
      const { error: saveErr } = await admin
        .from("planner_configs")
        .upsert(
          {
            user_id: userId,
            config: nextConfig,
            paid_loan_ids: existing?.paid_loan_ids ?? [],
            paid_loan_month: existing?.paid_loan_month ?? "",
            dismissed_suggestions: existing?.dismissed_suggestions ?? [],
            tax_filing_status: existing?.tax_filing_status ?? "single",
          },
          { onConflict: "user_id" }
        );
      if (saveErr) return errResult(`Failed to save planner config: ${saveErr.message}`);
      return okResult({ action: op, collection, item: saved, count: items.length });
    }

    case "update_tax_tracking": {
      const hasStatus = typeof args.tax_filing_status === "string";
      const hasPatch = Boolean(args.tracking_patch && typeof args.tracking_patch === "object");
      if (!hasStatus && !hasPatch) {
        return errResult("Provide tax_filing_status and/or tracking_patch.");
      }
      const year = typeof args.year === "string" ? args.year.trim() : "";
      if (hasPatch && !/^\d{4}$/.test(year)) {
        return errResult("year (4-digit string, e.g. '2026') is required when passing tracking_patch.");
      }

      const { data: existing, error: fetchErr } = await admin
        .from("planner_configs")
        .select("config, paid_loan_ids, paid_loan_month, dismissed_suggestions, tax_filing_status")
        .eq("user_id", userId)
        .maybeSingle();
      if (fetchErr) return errResult(`Database error: ${fetchErr.message}`);

      const existingConfig = (existing?.config ?? {}) as Record<string, unknown>;
      const nextConfig: Record<string, unknown> = { ...existingConfig };

      if (hasPatch) {
        const existingTracking =
          existingConfig.taxYearTracking && typeof existingConfig.taxYearTracking === "object"
            ? { ...(existingConfig.taxYearTracking as Record<string, Record<string, unknown>>) }
            : {};
        existingTracking[year] = {
          ...(existingTracking[year] ?? {}),
          ...(args.tracking_patch as Record<string, unknown>),
        };
        nextConfig.taxYearTracking = existingTracking;
      }

      const nextFilingStatus = hasStatus
        ? String(args.tax_filing_status)
        : (existing?.tax_filing_status ?? "single");

      const { data, error: saveErr } = await admin
        .from("planner_configs")
        .upsert(
          {
            user_id: userId,
            config: nextConfig,
            paid_loan_ids: existing?.paid_loan_ids ?? [],
            paid_loan_month: existing?.paid_loan_month ?? "",
            dismissed_suggestions: existing?.dismissed_suggestions ?? [],
            tax_filing_status: nextFilingStatus,
          },
          { onConflict: "user_id" }
        )
        .select("tax_filing_status, config, updated_at")
        .single();
      if (saveErr) return errResult(`Failed to update tax tracking: ${saveErr.message}`);

      const trackingByYear = (data.config as Record<string, unknown>)?.taxYearTracking as Record<string, unknown> | undefined;
      return okResult({
        updated: true,
        tax_filing_status: data.tax_filing_status,
        year: year || undefined,
        year_tracking: year ? trackingByYear?.[year] : undefined,
      });
    }

    default:
      return errResult(`Unknown tool: ${name}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: MCP_CORS_HEADERS });
  }

  if (req.method === "GET") {
    return new Response(
      JSON.stringify({ status: "ok", server: SERVER_INFO, transport: "streamable-http", tools: TOOLS.length }),
      { status: 200, headers: JSON_HEADERS }
    );
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: JSON_HEADERS,
    });
  }

  const userId = await authenticateRequest(req);
  if (!userId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: JSON_HEADERS,
    });
  }

  let body: { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }),
      { status: 400, headers: JSON_HEADERS }
    );
  }

  const { id, method, params } = body;

  if (id === undefined && method?.startsWith("notifications/")) {
    return new Response(null, { status: 202, headers: MCP_CORS_HEADERS });
  }

  const respond = (result: unknown) =>
    new Response(JSON.stringify({ jsonrpc: "2.0", id: id ?? null, result }), {
      status: 200,
      headers: JSON_HEADERS,
    });

  const respondError = (code: number, message: string) =>
    new Response(
      JSON.stringify({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }),
      { status: 200, headers: JSON_HEADERS }
    );

  try {
    switch (method) {
      case "initialize": {
        const requestedVersion =
          typeof params?.protocolVersion === "string" ? params.protocolVersion : "2025-03-26";
        return respond({
          protocolVersion: requestedVersion,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        });
      }
      case "ping":
        return respond({});
      case "tools/list":
        return respond({ tools: TOOLS });
      case "tools/call": {
        const toolName = typeof params?.name === "string" ? params.name : "";
        const toolArgs =
          params?.arguments && typeof params.arguments === "object"
            ? (params.arguments as Record<string, unknown>)
            : {};
        if (!toolName) return respondError(-32602, "Missing tool name");
        const result = await handleToolCall(userId, toolName, toolArgs);
        return respond(result);
      }
      default:
        return respondError(-32601, `Method not found: ${method}`);
    }
  } catch (err) {
    return respondError(-32603, (err as Error).message || "Internal server error");
  }
});
