// BeanCount Remote MCP Server (Streamable HTTP, JSON-RPC 2.0)
// Deploy with: supabase functions deploy beancount-mcp --no-verify-jwt
//
// Auth modes:
//   1. Personal MCP token (recommended for ChatGPT / Claude / MCP clients):
//      Set BEANCOUNT_MCP_TOKEN and BEANCOUNT_MCP_USER_ID in Supabase Edge Function secrets,
//      then pass `Authorization: Bearer <BEANCOUNT_MCP_TOKEN>`.
//   2. Standard Supabase Auth JWT:
//      Pass `Authorization: Bearer <supabase_access_token>`.
//
// All database queries and updates are strictly scoped to the authenticated user_id.
// integration_tokens is never exposed, and no destructive delete tools are provided.

import { getSupabaseAdmin, getSupabaseClient } from "../_shared/supabase.ts";
import {
  constantTimeEqual,
  resolveNamedEntity,
  summarizeTransactions,
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
  version: "1.0.0",
};

const TOOLS = [
  {
    name: "get_net_worth",
    description:
      "Get current BeanCount net worth summary (assets, credit card debt, liabilities, loans, points value) and recent net worth history snapshots.",
    inputSchema: {
      type: "object",
      properties: {
        history_days: {
          type: "integer",
          description: "Number of recent daily snapshots to return (default 30, max 365).",
          minimum: 1,
          maximum: 365,
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: "list_accounts",
    description:
      "List bank, cash, stock, and crypto accounts plus credit cards with current balances.",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["bank", "cash", "stock", "crypto"],
          description: "Optional filter for account type.",
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: "search_transactions",
    description:
      "Search transactions by date range, merchant/description keyword, category, or transaction type.",
    inputSchema: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "Start date (YYYY-MM-DD, inclusive)." },
        end_date: { type: "string", description: "End date (YYYY-MM-DD, inclusive)." },
        category: { type: "string", description: "Category slug (e.g. groceries, food_and_drink)." },
        query: { type: "string", description: "Case-insensitive keyword in name or merchant_name." },
        transaction_type: { type: "string", enum: ["income", "expense", "transfer"] },
        limit: { type: "integer", description: "Max rows to return (default 50, max 200).", minimum: 1, maximum: 200 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: "get_spending_summary",
    description:
      "Summarize total income, expenses, net cashflow, and spending by category for a date range (defaults to the current month).",
    inputSchema: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "Start date (YYYY-MM-DD)." },
        end_date: { type: "string", description: "End date (YYYY-MM-DD)." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: "list_holdings_and_loans",
    description: "List stock/crypto holdings (ticker, shares, cost basis) and active loans.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: "update_account_balance",
    description:
      "Update the balance of a bank, cash, stock, or crypto account. Identify by account_id or account_name.",
    inputSchema: {
      type: "object",
      properties: {
        account_id: { type: "string", description: "Account UUID (optional if account_name is given)." },
        account_name: { type: "string", description: "Account name (case-insensitive match)." },
        balance: { type: "number", description: "New account balance." },
      },
      required: ["balance"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: "update_credit_card_balance",
    description:
      "Update a credit card's balance_owed and/or points_balance. Identify by card_id or card_name.",
    inputSchema: {
      type: "object",
      properties: {
        card_id: { type: "string", description: "Credit card UUID (optional if card_name is given)." },
        card_name: { type: "string", description: "Credit card name (case-insensitive match)." },
        balance_owed: { type: "number", description: "New balance owed on the card." },
        points_balance: { type: "number", description: "Optional updated rewards points balance." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: "add_transaction",
    description:
      "Add a manual transaction (expense, income, or transfer) optionally linked to an account or credit card.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Merchant or transaction description." },
        amount: { type: "number", description: "Transaction amount (positive number)." },
        date: { type: "string", description: "Date in YYYY-MM-DD format (defaults to today)." },
        category: { type: "string", description: "Category slug (defaults to 'other')." },
        transaction_type: {
          type: "string",
          enum: ["expense", "income", "transfer"],
          description: "Defaults to 'expense'.",
        },
        account_name: { type: "string", description: "Optional account name to link." },
        card_name: { type: "string", description: "Optional credit card name to link." },
        notes: { type: "string", description: "Optional notes." },
      },
      required: ["name", "amount"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
];

async function authenticateRequest(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const url = new URL(req.url);
  const bearerToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : url.searchParams.get("token")?.trim() ?? "";

  if (!bearerToken) return null;

  // Mode 1: Scoped personal MCP token configured via Supabase secrets
  const configuredToken = Deno.env.get("BEANCOUNT_MCP_TOKEN")?.trim();
  const configuredUserId = Deno.env.get("BEANCOUNT_MCP_USER_ID")?.trim();
  if (configuredToken && configuredUserId && constantTimeEqual(bearerToken, configuredToken)) {
    return configuredUserId;
  }

  // Mode 2: Standard Supabase Auth user JWT
  if (authHeader.startsWith("Bearer ")) {
    const supabase = getSupabaseClient(authHeader);
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.id) return user.id;
  }

  return null;
}

function okResult(data: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

function errResult(message: string) {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}

function currentMonthRange() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const lastDay = new Date(Date.UTC(y, now.getUTCMonth() + 1, 0)).getUTCDate();
  return {
    start: `${y}-${m}-01`,
    end: `${y}-${m}-${String(lastDay).padStart(2, "0")}`,
  };
}

async function handleToolCall(
  userId: string,
  name: string,
  args: Record<string, unknown>
) {
  const admin = getSupabaseAdmin();

  switch (name) {
    case "get_net_worth": {
      const historyDays = Math.min(365, Math.max(1, Number(args.history_days ?? 30)));
      const [accountsRes, cardsRes, debtsRes, liabsRes, loansRes, historyRes] =
        await Promise.all([
          admin.from("accounts").select("type, balance").eq("user_id", userId),
          admin
            .from("credit_cards")
            .select("balance_owed, points_balance, points_value_cents")
            .eq("user_id", userId),
          admin
            .from("debts_owed")
            .select("amount")
            .eq("user_id", userId)
            .neq("status", "paid"),
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

      let bankTotal = 0;
      let cashTotal = 0;
      let stockTotal = 0;
      let cryptoTotal = 0;
      for (const a of accountsRes.data ?? []) {
        const bal = Number(a.balance);
        if (a.type === "bank") bankTotal += bal;
        else if (a.type === "cash") cashTotal += bal;
        else if (a.type === "stock") stockTotal += bal;
        else if (a.type === "crypto") cryptoTotal += bal;
      }
      const assetsTotal = bankTotal + cashTotal + stockTotal + cryptoTotal;
      const creditCardDebt = (cardsRes.data ?? []).reduce(
        (s, c) => s + Math.max(0, Number(c.balance_owed)),
        0
      );
      const pointsValue = (cardsRes.data ?? []).reduce(
        (s, c) => s + (Number(c.points_balance) * Number(c.points_value_cents)) / 100,
        0
      );
      const debtsOwedTotal = (debtsRes.data ?? []).reduce((s, d) => s + Number(d.amount), 0);
      const liabilitiesTotal = (liabsRes.data ?? []).reduce((s, l) => s + Number(l.amount), 0);
      const loansTotal = (loansRes.data ?? []).reduce((s, l) => s + Number(l.balance), 0);
      const netWorth =
        assetsTotal + debtsOwedTotal + pointsValue - creditCardDebt - liabilitiesTotal;

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
        .select("id, name, type, balance, currency, updated_at")
        .eq("user_id", userId)
        .order("type")
        .order("balance", { ascending: false });
      if (typeof args.type === "string") {
        accQuery = accQuery.eq("type", args.type);
      }

      const [accRes, cardRes] = await Promise.all([
        accQuery,
        admin
          .from("credit_cards")
          .select("id, name, balance_owed, credit_limit, points_balance, points_value_cents, due_date, updated_at")
          .eq("user_id", userId)
          .order("balance_owed", { ascending: false }),
      ]);
      if (accRes.error) return errResult(`Database error: ${accRes.error.message}`);
      if (cardRes.error) return errResult(`Database error: ${cardRes.error.message}`);

      return okResult({
        accounts: accRes.data ?? [],
        creditCards: cardRes.data ?? [],
      });
    }

    case "search_transactions": {
      const limit = Math.min(200, Math.max(1, Number(args.limit ?? 50)));
      let q = admin
        .from("transactions")
        .select("id, date, name, merchant_name, amount, category, transaction_type, is_ignored, notes")
        .eq("user_id", userId)
        .order("date", { ascending: false })
        .limit(limit);

      if (typeof args.start_date === "string") q = q.gte("date", args.start_date);
      if (typeof args.end_date === "string") q = q.lte("date", args.end_date);
      if (typeof args.category === "string") q = q.eq("category", args.category);
      if (typeof args.transaction_type === "string") {
        q = q.eq("transaction_type", args.transaction_type);
      }
      if (typeof args.query === "string" && args.query.trim()) {
        const escaped = args.query.trim().replace(/[%_,]/g, "");
        if (escaped) {
          q = q.or(`name.ilike.%${escaped}%,merchant_name.ilike.%${escaped}%`);
        }
      }

      const { data, error } = await q;
      if (error) return errResult(`Database error: ${error.message}`);
      return okResult({ count: data?.length ?? 0, transactions: data ?? [] });
    }

    case "get_spending_summary": {
      const defaults = currentMonthRange();
      const start = typeof args.start_date === "string" ? args.start_date : defaults.start;
      const end = typeof args.end_date === "string" ? args.end_date : defaults.end;

      const { data, error } = await admin
        .from("transactions")
        .select("amount, category, transaction_type, is_ignored")
        .eq("user_id", userId)
        .gte("date", start)
        .lte("date", end);
      if (error) return errResult(`Database error: ${error.message}`);

      return okResult({
        period: { start_date: start, end_date: end },
        ...summarizeTransactions(data ?? []),
      });
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
          .select("id, name, type, balance, original_amount, interest_rate, monthly_payment, payment_day")
          .eq("user_id", userId)
          .order("balance", { ascending: false }),
      ]);
      if (holdingsRes.error) return errResult(`Database error: ${holdingsRes.error.message}`);
      if (loansRes.error) return errResult(`Database error: ${loansRes.error.message}`);

      return okResult({
        holdings: holdingsRes.data ?? [],
        loans: loansRes.data ?? [],
      });
    }

    case "update_account_balance": {
      const balance = Number(args.balance);
      if (!Number.isFinite(balance)) {
        return errResult("balance must be a valid finite number.");
      }

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
        .update({ balance })
        .eq("id", target.id)
        .eq("user_id", userId)
        .select("id, name, type, balance, currency, updated_at")
        .single();
      if (updateErr) return errResult(`Failed to update account: ${updateErr.message}`);

      return okResult({
        updated: true,
        account: updated,
        previous_balance: Number(target.balance),
        new_balance: Number(updated.balance),
      });
    }

    case "update_credit_card_balance": {
      const updates: Record<string, number> = {};
      if (args.balance_owed !== undefined) {
        const val = Number(args.balance_owed);
        if (!Number.isFinite(val)) return errResult("balance_owed must be a valid number.");
        updates.balance_owed = val;
      }
      if (args.points_balance !== undefined) {
        const val = Number(args.points_balance);
        if (!Number.isFinite(val)) return errResult("points_balance must be a valid number.");
        updates.points_balance = val;
      }
      if (Object.keys(updates).length === 0) {
        return errResult("Provide balance_owed and/or points_balance to update.");
      }

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
        .select("id, name, balance_owed, points_balance, updated_at")
        .single();
      if (updateErr) return errResult(`Failed to update credit card: ${updateErr.message}`);

      return okResult({
        updated: true,
        creditCard: updated,
        previous_balance_owed: Number(target.balance_owed),
        previous_points_balance: Number(target.points_balance),
      });
    }

    case "add_transaction": {
      const txnName = typeof args.name === "string" ? args.name.trim() : "";
      const amount = Number(args.amount);
      if (!txnName) return errResult("name is required.");
      if (!Number.isFinite(amount) || amount <= 0) {
        return errResult("amount must be a positive number.");
      }

      const category =
        typeof args.category === "string" && VALID_CATEGORIES.has(args.category)
          ? args.category
          : "other";
      const transactionType =
        typeof args.transaction_type === "string" &&
        VALID_TRANSACTION_TYPES.has(args.transaction_type)
          ? args.transaction_type
          : "expense";
      const date =
        typeof args.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.date)
          ? args.date
          : new Date().toISOString().slice(0, 10);

      let accountId: string | null = null;
      let creditCardId: string | null = null;

      if (typeof args.account_name === "string" && args.account_name.trim()) {
        const { data: accounts } = await admin
          .from("accounts")
          .select("id, name")
          .eq("user_id", userId);
        const res = resolveNamedEntity(accounts ?? [], undefined, args.account_name, "account");
        if (!res.ok) return errResult(res.error);
        accountId = res.match.id;
      } else if (typeof args.card_name === "string" && args.card_name.trim()) {
        const { data: cards } = await admin
          .from("credit_cards")
          .select("id, name")
          .eq("user_id", userId);
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
          amount,
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
      JSON.stringify({ status: "ok", server: SERVER_INFO, transport: "streamable-http" }),
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

  // JSON-RPC notifications have no id and expect 202 Accepted.
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
