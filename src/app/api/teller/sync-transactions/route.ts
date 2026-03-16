import { NextResponse } from "next/server";
import { tellerGet, TellerTransaction } from "@/lib/teller";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guessCategory } from "@/lib/categories";
import { v4 as uuidv4 } from "uuid";

// Map Teller's category strings → our category keys
function tellerCategoryToKey(cat: string | null): string {
  if (!cat) return "other";
  const map: Record<string, string> = {
    accommodation:           "travel",
    advertising:             "general_services",
    bar:                     "food_and_drink",
    charity:                 "donations",
    clothing:                "shopping",
    dining:                  "food_and_drink",
    education:               "education",
    electronics:             "shopping",
    entertainment:           "entertainment",
    fuel:                    "transportation",
    groceries:               "groceries",
    health:                  "medical",
    home:                    "home_improvement",
    income:                  "income",
    insurance:               "rent_and_utilities",
    investment:              "transfer_in",
    loan:                    "loan_payments",
    office:                  "general_services",
    personal:                "personal_care",
    phone:                   "subscriptions",
    restaurants:             "food_and_drink",
    shopping:                "shopping",
    software:                "subscriptions",
    sport:                   "personal_care",
    subscription:            "subscriptions",
    tax:                     "government",
    transport:               "transportation",
    travel:                  "travel",
    utilities:               "rent_and_utilities",
  };
  return map[cat.toLowerCase()] ?? "other";
}

/**
 * Use every available Teller signal to assign the best category.
 *
 * Priority order:
 * 1. Negative amount → income (credit/refund)
 * 2. counterparty.type === "person" → peer transfer
 * 3. tx.type wire/ach/digital_payment with no named merchant → transfer
 * 4. Teller-provided category (most reliable for posted txns)
 * 5. Keyword matching on merchant name, then description
 */
function classifyTellerTransaction(
  tx: TellerTransaction,
  merchantName: string | null,
): { category: string; txType: "income" | "expense" | "transfer" } {
  const amount = parseFloat(tx.amount);

  // 1. Negative = money coming in
  if (amount < 0) return { category: "income", txType: "income" };

  // 2. Counterparty type "person" = P2P transfer (Zelle, Venmo, CashApp, etc.)
  const cpType = tx.details?.counterparty?.type;
  if (cpType === "person") {
    return { category: amount < 0 ? "transfer_in" : "transfer_out", txType: "transfer" };
  }

  // 3. Transaction type signals
  const txTypeLower = (tx.type ?? "").toLowerCase();
  if (txTypeLower === "wire" || txTypeLower === "ach") {
    // Only treat as transfer when there's no merchant name (bare ACH = inter-account)
    if (!merchantName) {
      return { category: amount < 0 ? "transfer_in" : "transfer_out", txType: "transfer" };
    }
  }
  if (txTypeLower === "digital_payment" && !merchantName) {
    return { category: "transfer_out", txType: "transfer" };
  }

  // 4. Teller-provided category
  const tellerCat = tx.details?.category ?? null;
  if (tellerCat) {
    const catKey = tellerCategoryToKey(tellerCat);
    if (catKey !== "other") {
      const isTransfer = catKey.startsWith("transfer");
      return {
        category: catKey,
        txType: isTransfer ? "transfer" : catKey === "income" ? "income" : "expense",
      };
    }
  }

  // 5. Keyword fallback (tests merchantName first, then description)
  const guessed = guessCategory(tx.description, amount, merchantName);
  const isTransfer = guessed.category.startsWith("transfer");
  return {
    category: guessed.category,
    txType: isTransfer ? "transfer" : guessed.type,
  };
}

export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Pull linked tokens for accounts
    const { data: accountTokens } = await supabaseAdmin
      .from("integration_tokens")
      .select("entity_id, access_token")
      .eq("user_id", user.id)
      .eq("provider", "teller")
      .eq("entity_type", "account");

    // Pull linked tokens for credit cards
    const { data: cardTokens } = await supabaseAdmin
      .from("integration_tokens")
      .select("entity_id, access_token")
      .eq("user_id", user.id)
      .eq("provider", "teller")
      .eq("entity_type", "credit_card");

    // Get account details
    const accountIds = (accountTokens ?? []).map((t) => t.entity_id);
    const cardIds = (cardTokens ?? []).map((t) => t.entity_id);

    const { data: accounts } = accountIds.length > 0
      ? await supabaseAdmin
          .from("accounts")
          .select("id, teller_account_id")
          .in("id", accountIds)
      : { data: [] };

    const { data: cards } = cardIds.length > 0
      ? await supabaseAdmin
          .from("credit_cards")
          .select("id, teller_account_id")
          .in("id", cardIds)
      : { data: [] };

    // Build combined linked list with access tokens
    const tokenMap = new Map<string, string>();
    for (const t of accountTokens ?? []) tokenMap.set(t.entity_id, t.access_token);
    for (const t of cardTokens ?? []) tokenMap.set(t.entity_id, t.access_token);

    const linked = [
      ...(accounts ?? []).map((a) => ({ id: a.id, teller_account_id: a.teller_account_id })),
      ...(cards ?? []).map((c) => ({ id: c.id, teller_account_id: c.teller_account_id })),
    ];

    if (linked.length === 0) {
      return NextResponse.json({ added: 0, message: "No linked accounts" });
    }

    let totalAdded = 0;

    for (const row of linked) {
      const accessToken = tokenMap.get(row.id);
      if (!accessToken || !row.teller_account_id) continue;

      try {
        const transactions = await tellerGet<TellerTransaction[]>(
          `/accounts/${row.teller_account_id}/transactions`,
          accessToken
        );

        for (const tx of transactions) {
          if (tx.status === "pending") continue; // only sync posted transactions

          const amount = parseFloat(tx.amount);
          const merchantName = tx.details?.counterparty?.name ?? null;
          const { category: catKey, txType } = classifyTellerTransaction(tx, merchantName);

          // INSERT with ON CONFLICT DO NOTHING (ignore duplicates)
          await supabaseAdmin
            .from("transactions")
            .upsert(
              {
                id: uuidv4(),
                user_id: user.id,
                account_id: row.id,
                teller_transaction_id: tx.id,
                amount,
                date: tx.date,
                name: tx.description,
                merchant_name: merchantName,
                category: catKey,
                subcategory: null,
                transaction_type: txType,
                is_manual: false,
              },
              { onConflict: "teller_transaction_id", ignoreDuplicates: true }
            );
          totalAdded++;
        }
      } catch (e) {
        console.error(`Failed to sync transactions for account ${row.id}:`, e);
      }
    }

    return NextResponse.json({ added: totalAdded });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Teller sync-transactions error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
