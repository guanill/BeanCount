import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Configuration, PlaidApi, PlaidEnvironments } from "npm:plaid@26";
import { corsHeaders } from "../_shared/cors.ts";
import { getSupabaseClient, getSupabaseAdmin } from "../_shared/supabase.ts";
import { applyMerchantCategoryRule, plaidCategoryToKey, guessCategory, normalizeMerchantKey } from "../_shared/categories.ts";

function getPlaidClient() {
  const env = Deno.env.get("PLAID_ENV") || "sandbox";
  return new PlaidApi(
    new Configuration({
      basePath: (PlaidEnvironments as Record<string, string>)[env],
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": Deno.env.get("PLAID_CLIENT_ID"),
          "PLAID-SECRET": Deno.env.get("PLAID_SECRET"),
        },
      },
    })
  );
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = getSupabaseClient(req.headers.get("Authorization")!);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const admin = getSupabaseAdmin();
    const plaid = getPlaidClient();
    const { data: categoryRules, error: categoryRulesError } = await admin
      .from("merchant_category_rules")
      .select("merchant_key, category, transaction_type")
      .eq("user_id", user.id);
    if (categoryRulesError) throw categoryRulesError;
    const categoryRuleMap = new Map(
      (categoryRules ?? []).map(rule => [rule.merchant_key, rule]),
    );

    const { data: tokens } = await admin.from("integration_tokens")
      .select("entity_id, access_token")
      .eq("user_id", user.id).eq("provider", "plaid").eq("entity_type", "account");

    if (!tokens?.length) return new Response(JSON.stringify({ added: 0, message: "No linked accounts" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const entityIds = tokens.map((t) => t.entity_id);
    const { data: accounts } = await admin.from("accounts")
      .select("id, plaid_account_id, plaid_item_id")
      .in("id", entityIds).not("plaid_item_id", "is", null);

    if (!accounts?.length) return new Response(JSON.stringify({ added: 0, message: "No linked accounts" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const tokenByEntityId = new Map(tokens.map((t) => [t.entity_id, t.access_token]));
    const itemMap = new Map<string, string>();
    for (const account of accounts) {
      if (account.plaid_item_id && !itemMap.has(account.plaid_item_id)) {
        const token = tokenByEntityId.get(account.id);
        if (token) itemMap.set(account.plaid_item_id, token);
      }
    }

    let totalAdded = 0;

    for (const [itemId, accessToken] of itemMap.entries()) {
      const { data: cursorRow } = await admin.from("plaid_sync_cursors")
        .select("cursor").eq("item_id", itemId).maybeSingle();

      let cursor = cursorRow?.cursor ?? "";
      let hasMore = true;

      while (hasMore) {
        const response = await plaid.transactionsSync({
          access_token: accessToken,
          cursor: cursor || undefined,
        });

        const { added, modified, removed, next_cursor, has_more } = response.data;

        const { data: accountRows } = await admin.from("accounts")
          .select("id, plaid_account_id").eq("plaid_item_id", itemId).eq("user_id", user.id);

        const accountMap = new Map<string, string>();
        if (accountRows) {
          for (const row of accountRows) {
            if (row.plaid_account_id) accountMap.set(row.plaid_account_id, row.id);
          }
        }

        for (const tx of added) {
          const plaidPrimary = (tx.personal_finance_category as { primary?: string } | null)?.primary ?? "";
          const fallbackCategory = plaidPrimary
            ? plaidCategoryToKey(plaidPrimary)
            : guessCategory(tx.name, tx.amount, tx.merchant_name ?? null).category;
          const fallbackType = tx.amount < 0
            ? "income"
            : fallbackCategory.startsWith("transfer") ? "transfer" : "expense";
          const merchantKey = normalizeMerchantKey(tx.merchant_name ?? tx.name);
          const classification = applyMerchantCategoryRule(
            { category: fallbackCategory, type: fallbackType },
            merchantKey ? categoryRuleMap.get(merchantKey) : undefined,
          );
          const accountId = accountMap.get(tx.account_id) ?? null;

          await admin.from("transactions").upsert({
            id: crypto.randomUUID(),
            user_id: user.id,
            account_id: accountId,
            plaid_transaction_id: tx.transaction_id,
            amount: tx.amount,
            date: tx.date,
            name: tx.name,
            merchant_name: tx.merchant_name ?? null,
            category: classification.category,
            subcategory: (tx.personal_finance_category as { detailed?: string } | null)?.detailed ?? null,
            transaction_type: classification.type,
            is_manual: false,
          }, { onConflict: "plaid_transaction_id", ignoreDuplicates: true });
          totalAdded++;
        }

        for (const tx of modified) {
          const plaidPrimary = (tx.personal_finance_category as { primary?: string } | null)?.primary ?? "";
          const fallbackCategory = plaidPrimary ? plaidCategoryToKey(plaidPrimary) : "other";
          const fallbackType = tx.amount < 0
            ? "income"
            : fallbackCategory.startsWith("transfer") ? "transfer" : "expense";
          const merchantKey = normalizeMerchantKey(tx.merchant_name ?? tx.name);
          const classification = applyMerchantCategoryRule(
            { category: fallbackCategory, type: fallbackType },
            merchantKey ? categoryRuleMap.get(merchantKey) : undefined,
          );

          await admin.from("transactions").update({
            amount: tx.amount, date: tx.date, name: tx.name,
            merchant_name: tx.merchant_name ?? null,
            category: classification.category, transaction_type: classification.type,
          }).eq("plaid_transaction_id", tx.transaction_id);
        }

        for (const tx of removed) {
          await admin.from("transactions").delete().eq("plaid_transaction_id", tx.transaction_id);
        }

        cursor = next_cursor;
        hasMore = has_more;
      }

      await admin.from("plaid_sync_cursors").upsert(
        { item_id: itemId, cursor, user_id: user.id },
        { onConflict: "item_id" }
      );
    }

    return new Response(JSON.stringify({ added: totalAdded }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
