import { NextResponse } from "next/server";
import { plaidClient } from "@/lib/plaid";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { plaidCategoryToKey, guessCategory } from "@/lib/categories";
import { v4 as uuidv4 } from "uuid";

export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Find all unique Plaid items via integration_tokens + accounts
    const { data: tokens } = await supabaseAdmin
      .from("integration_tokens")
      .select("entity_id, access_token")
      .eq("user_id", user.id)
      .eq("provider", "plaid")
      .eq("entity_type", "account");

    if (!tokens || tokens.length === 0) {
      return NextResponse.json({ added: 0, message: "No linked accounts" });
    }

    // Get accounts to find plaid_item_id
    const entityIds = tokens.map((t) => t.entity_id);
    const { data: accounts } = await supabaseAdmin
      .from("accounts")
      .select("id, plaid_account_id, plaid_item_id")
      .in("id", entityIds)
      .not("plaid_item_id", "is", null);

    if (!accounts || accounts.length === 0) {
      return NextResponse.json({ added: 0, message: "No linked accounts" });
    }

    // Build a map of entity_id → access_token
    const tokenByEntityId = new Map(tokens.map((t) => [t.entity_id, t.access_token]));

    // Deduplicate by plaid_item_id to get unique items
    const itemMap = new Map<string, string>(); // item_id → access_token
    for (const account of accounts) {
      if (account.plaid_item_id && !itemMap.has(account.plaid_item_id)) {
        const token = tokenByEntityId.get(account.id);
        if (token) itemMap.set(account.plaid_item_id, token);
      }
    }

    let totalAdded = 0;

    for (const [itemId, accessToken] of itemMap.entries()) {
      // Get or create cursor for this item
      const { data: cursorRow } = await supabaseAdmin
        .from("plaid_sync_cursors")
        .select("cursor")
        .eq("item_id", itemId)
        .maybeSingle();

      let cursor = cursorRow?.cursor ?? "";
      let hasMore = true;

      while (hasMore) {
        const response = await plaidClient.transactionsSync({
          access_token: accessToken,
          cursor: cursor || undefined,
        });

        const { added, modified, removed, next_cursor, has_more } = response.data;

        // Build a map of plaid_account_id → our account id
        const { data: accountRows } = await supabaseAdmin
          .from("accounts")
          .select("id, plaid_account_id")
          .eq("plaid_item_id", itemId)
          .eq("user_id", user.id);

        const accountMap = new Map<string, string>();
        if (accountRows) {
          for (const row of accountRows) {
            if (row.plaid_account_id) accountMap.set(row.plaid_account_id, row.id);
          }
        }

        // Insert new transactions
        for (const tx of added) {
          const plaidPrimary =
            (tx.personal_finance_category as { primary?: string } | null)?.primary ?? "";
          const catKey = plaidPrimary
            ? plaidCategoryToKey(plaidPrimary)
            : guessCategory(tx.name, tx.amount, tx.merchant_name ?? null).category;
          const txType =
            tx.amount < 0 ? "income"
            : catKey.startsWith("transfer") ? "transfer"
            : "expense";

          const accountId = accountMap.get(tx.account_id) ?? null;

          // INSERT with ON CONFLICT DO NOTHING (ignore duplicates)
          await supabaseAdmin
            .from("transactions")
            .upsert(
              {
                id: uuidv4(),
                user_id: user.id,
                account_id: accountId,
                plaid_transaction_id: tx.transaction_id,
                amount: tx.amount,
                date: tx.date,
                name: tx.name,
                merchant_name: tx.merchant_name ?? null,
                category: catKey,
                subcategory: (tx.personal_finance_category as { detailed?: string } | null)?.detailed ?? null,
                transaction_type: txType,
                is_manual: false,
              },
              { onConflict: "plaid_transaction_id", ignoreDuplicates: true }
            );
          totalAdded++;
        }

        // Update modified transactions
        for (const tx of modified) {
          const plaidPrimary =
            (tx.personal_finance_category as { primary?: string } | null)?.primary ?? "";
          const catKey = plaidPrimary ? plaidCategoryToKey(plaidPrimary) : "other";
          const txType =
            tx.amount < 0 ? "income"
            : catKey.startsWith("transfer") ? "transfer"
            : "expense";

          await supabaseAdmin
            .from("transactions")
            .update({
              amount: tx.amount,
              date: tx.date,
              name: tx.name,
              merchant_name: tx.merchant_name ?? null,
              category: catKey,
              transaction_type: txType,
            })
            .eq("plaid_transaction_id", tx.transaction_id);
        }

        // Remove deleted transactions
        for (const tx of removed) {
          await supabaseAdmin
            .from("transactions")
            .delete()
            .eq("plaid_transaction_id", tx.transaction_id);
        }

        cursor = next_cursor;
        hasMore = has_more;
      }

      // Persist latest cursor
      await supabaseAdmin
        .from("plaid_sync_cursors")
        .upsert(
          { item_id: itemId, cursor, user_id: user.id },
          { onConflict: "item_id" }
        );
    }

    return NextResponse.json({ added: totalAdded });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("sync-transactions error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
