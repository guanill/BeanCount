// BeanCount Remote MCP Server (Streamable HTTP, JSON-RPC 2.0)
// Deploy with: supabase functions deploy beancount-mcp --no-verify-jwt
//
// Full CRUD across accounts, credit_cards, debts_owed, liabilities, loans,
// stock_holdings, transactions, and planner_configs — strictly scoped to user_id.
// integration_tokens (Plaid/Teller secrets) is never exposed.

import { getSupabaseAdmin, getSupabaseClient } from "../_shared/supabase.ts";
import {
  appendSplitTag,
  attachRefundTag,
  canDeleteSplitOriginal,
  classifyRefundPair,
  constantTimeEqual,
  defaultSplitNames,
  defaultTransactionTypeForCategory,
  isSplitOriginal,
  normalizeMerchantKey,
  parseRefundLink,
  rankRefundCandidates,
  removeRefundTag,
  resolveNamedEntity,
  summarizeTransactions,
  toSignedAmount,
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
  version: "2.1.0",
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
    description: "Update any field on a loan (name, type, balance, original_amount, interest_rate, monthly_payment, payment_day, deferral_months, deferral_type, notes).",
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
      },
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
    description: "Add a manual transaction (expense, income, or transfer) optionally linked to an account or credit card.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        amount: { type: "number" },
        date: { type: "string", description: "YYYY-MM-DD (defaults to today)." },
        category: { type: "string", description: "Category slug (defaults to 'other')." },
        transaction_type: { type: "string", enum: ["expense", "income", "transfer"] },
        account_name: { type: "string" },
        card_name: { type: "string" },
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
      "Update fields on an existing transaction by transaction_id (name, merchant_name, amount, date, category, transaction_type, is_ignored, notes). Automatically syncs merchant_name on rename and remembers merchant category rules when category changes.",
    inputSchema: {
      type: "object",
      properties: {
        transaction_id: { type: "string" },
        name: { type: "string" },
        merchant_name: { type: "string" },
        amount: { type: "number" },
        date: { type: "string", description: "YYYY-MM-DD." },
        category: { type: "string" },
        transaction_type: { type: "string", enum: ["expense", "income", "transfer"] },
        is_ignored: { type: "boolean" },
        notes: { type: "string" },
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
      "Update planner settings (tax_filing_status, paid_loan_ids, paid_loan_month, dismissed_suggestions, or merge fields into config JSON).",
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
      return okResult(data ?? { config: {}, paid_loan_ids: [], paid_loan_month: "", tax_filing_status: "single" });
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
      const amount = Number(args.amount);
      if (!txnName) return errResult("name is required.");
      if (!Number.isFinite(amount) || amount <= 0) return errResult("amount must be a positive number.");

      const category =
        typeof args.category === "string" && VALID_CATEGORIES.has(args.category) ? args.category : "other";
      const transactionType =
        typeof args.transaction_type === "string" && VALID_TRANSACTION_TYPES.has(args.transaction_type)
          ? args.transaction_type
          : "expense";
      const date =
        typeof args.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.date)
          ? args.date
          : new Date().toISOString().slice(0, 10);

      let accountId: string | null = null;
      let creditCardId: string | null = null;

      if (typeof args.account_name === "string" && args.account_name.trim()) {
        const { data: accounts } = await admin.from("accounts").select("id, name").eq("user_id", userId);
        const res = resolveNamedEntity(accounts ?? [], undefined, args.account_name, "account");
        if (!res.ok) return errResult(res.error);
        accountId = res.match.id;
      } else if (typeof args.card_name === "string" && args.card_name.trim()) {
        const { data: cards } = await admin.from("credit_cards").select("id, name").eq("user_id", userId);
        const res = resolveNamedEntity(cards ?? [], undefined, args.card_name, "card");
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
          merchant_name: txnName,
          amount: toSignedAmount(amount, transactionType),
          date,
          category,
          transaction_type: transactionType,
          is_manual: true,
          notes: typeof args.notes === "string" ? args.notes : null,
        })
        .select("id, date, name, amount, category, transaction_type, account_id, credit_card_id")
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
        updates.merchant_name = typeof args.merchant_name === "string" ? args.merchant_name : null;
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
      if (typeof args.transaction_type === "string") {
        if (!VALID_TRANSACTION_TYPES.has(args.transaction_type)) {
          return errResult("transaction_type must be expense, income, or transfer.");
        }
        updates.transaction_type = args.transaction_type;
      }
      if (typeof args.is_ignored === "boolean") updates.is_ignored = args.is_ignored;
      if (args.notes !== undefined) updates.notes = typeof args.notes === "string" ? args.notes : null;
      if (Object.keys(updates).length === 0) return errResult("Provide at least one field to update.");

      const { data: updated, error } = await admin
        .from("transactions")
        .update(updates)
        .eq("id", txnId)
        .eq("user_id", userId)
        .select("id, date, name, merchant_name, amount, category, transaction_type, is_ignored, notes")
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
