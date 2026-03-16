import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { getSupabaseClient, getSupabaseAdmin } from "../_shared/supabase.ts";
import { tellerFetch, TellerTransaction } from "../_shared/teller.ts";
import { guessCategory } from "../_shared/categories.ts";

function tellerCategoryToKey(cat: string | null): string {
  if (!cat) return "other";
  const map: Record<string, string> = {
    accommodation: "travel", advertising: "general_services", bar: "food_and_drink",
    charity: "donations", clothing: "shopping", dining: "food_and_drink",
    education: "education", electronics: "shopping", entertainment: "entertainment",
    fuel: "transportation", groceries: "groceries", health: "medical",
    home: "home_improvement", income: "income", insurance: "rent_and_utilities",
    investment: "transfer_in", loan: "loan_payments", office: "general_services",
    personal: "personal_care", phone: "subscriptions", restaurants: "food_and_drink",
    shopping: "shopping", software: "subscriptions", sport: "personal_care",
    subscription: "subscriptions", tax: "government", transport: "transportation",
    travel: "travel", utilities: "rent_and_utilities",
  };
  return map[cat.toLowerCase()] ?? "other";
}

function classifyTellerTransaction(
  tx: TellerTransaction,
  merchantName: string | null,
): { category: string; txType: "income" | "expense" | "transfer" } {
  const amount = parseFloat(tx.amount);
  if (amount < 0) return { category: "income", txType: "income" };

  const cpType = tx.details?.counterparty?.type;
  if (cpType === "person") {
    return { category: amount < 0 ? "transfer_in" : "transfer_out", txType: "transfer" };
  }

  const txTypeLower = (tx.type ?? "").toLowerCase();
  if ((txTypeLower === "wire" || txTypeLower === "ach") && !merchantName) {
    return { category: amount < 0 ? "transfer_in" : "transfer_out", txType: "transfer" };
  }
  if (txTypeLower === "digital_payment" && !merchantName) {
    return { category: "transfer_out", txType: "transfer" };
  }

  const tellerCat = tx.details?.category ?? null;
  if (tellerCat) {
    const catKey = tellerCategoryToKey(tellerCat);
    if (catKey !== "other") {
      const isTransfer = catKey.startsWith("transfer");
      return { category: catKey, txType: isTransfer ? "transfer" : catKey === "income" ? "income" : "expense" };
    }
  }

  const guessed = guessCategory(tx.description, amount, merchantName);
  const isTransfer = guessed.category.startsWith("transfer");
  return { category: guessed.category, txType: isTransfer ? "transfer" : guessed.type };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = getSupabaseClient(req.headers.get("Authorization")!);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const admin = getSupabaseAdmin();

    const { data: accountTokens } = await admin.from("integration_tokens")
      .select("entity_id, access_token")
      .eq("user_id", user.id).eq("provider", "teller").eq("entity_type", "account");

    const { data: cardTokens } = await admin.from("integration_tokens")
      .select("entity_id, access_token")
      .eq("user_id", user.id).eq("provider", "teller").eq("entity_type", "credit_card");

    const accountIds = (accountTokens ?? []).map((t) => t.entity_id);
    const cardIds = (cardTokens ?? []).map((t) => t.entity_id);

    const { data: accounts } = accountIds.length > 0
      ? await admin.from("accounts").select("id, teller_account_id").in("id", accountIds)
      : { data: [] };

    const { data: cards } = cardIds.length > 0
      ? await admin.from("credit_cards").select("id, teller_account_id").in("id", cardIds)
      : { data: [] };

    const tokenMap = new Map<string, string>();
    for (const t of accountTokens ?? []) tokenMap.set(t.entity_id, t.access_token);
    for (const t of cardTokens ?? []) tokenMap.set(t.entity_id, t.access_token);

    const linked = [
      ...(accounts ?? []).map((a) => ({ id: a.id, teller_account_id: a.teller_account_id })),
      ...(cards ?? []).map((c) => ({ id: c.id, teller_account_id: c.teller_account_id })),
    ];

    if (!linked.length) return new Response(JSON.stringify({ added: 0, message: "No linked accounts" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    let totalAdded = 0;

    for (const row of linked) {
      const accessToken = tokenMap.get(row.id);
      if (!accessToken || !row.teller_account_id) continue;

      try {
        const transactions = await tellerFetch<TellerTransaction[]>(
          `/accounts/${row.teller_account_id}/transactions`, accessToken);

        if (!Array.isArray(transactions)) {
          console.error(`Unexpected response for account ${row.id}:`, transactions);
          continue;
        }

        for (const tx of transactions) {
          if (tx.status === "pending") continue;
          const amount = parseFloat(tx.amount);
          const merchantName = tx.details?.counterparty?.name ?? null;
          const { category: catKey, txType } = classifyTellerTransaction(tx, merchantName);

          await admin.from("transactions").upsert({
            id: crypto.randomUUID(),
            user_id: user.id,
            account_id: row.id,
            teller_transaction_id: tx.id,
            amount, date: tx.date, name: tx.description,
            merchant_name: merchantName, category: catKey,
            subcategory: null, transaction_type: txType, is_manual: false,
          }, { onConflict: "teller_transaction_id", ignoreDuplicates: true });
          totalAdded++;
        }
      } catch (e) {
        console.error(`Failed to sync transactions for account ${row.id}:`, e);
        const msg = e instanceof Error ? e.message : String(e);
        // Don't let one account failure kill the whole sync
        if (linked.length === 1) {
          return new Response(JSON.stringify({ error: `Sync failed: ${msg.slice(0, 200)}` }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }
    }

    return new Response(JSON.stringify({ added: totalAdded }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
