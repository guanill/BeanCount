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
    console.log("[sync-tx] Starting sync...");
    const supabase = getSupabaseClient(req.headers.get("Authorization")!);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.log("[sync-tx] No user found, returning 401");
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    console.log("[sync-tx] User:", user.id);

    const admin = getSupabaseAdmin();

    const { data: accountTokens, error: atErr } = await admin.from("integration_tokens")
      .select("entity_id, access_token")
      .eq("user_id", user.id).eq("provider", "teller").eq("entity_type", "account");
    console.log("[sync-tx] Account tokens found:", accountTokens?.length ?? 0, atErr ? `error: ${atErr.message}` : "");

    const { data: cardTokens, error: ctErr } = await admin.from("integration_tokens")
      .select("entity_id, access_token")
      .eq("user_id", user.id).eq("provider", "teller").eq("entity_type", "credit_card");
    console.log("[sync-tx] Card tokens found:", cardTokens?.length ?? 0, ctErr ? `error: ${ctErr.message}` : "");

    const accountIds = (accountTokens ?? []).map((t) => t.entity_id);
    const cardIds = (cardTokens ?? []).map((t) => t.entity_id);

    const { data: accounts } = accountIds.length > 0
      ? await admin.from("accounts").select("id, teller_account_id").in("id", accountIds)
      : { data: [] };

    const { data: cards } = cardIds.length > 0
      ? await admin.from("credit_cards").select("id, teller_account_id").in("id", cardIds)
      : { data: [] };

    console.log("[sync-tx] DB accounts matched:", accounts?.length ?? 0, "cards:", cards?.length ?? 0);

    const tokenMap = new Map<string, string>();
    for (const t of accountTokens ?? []) tokenMap.set(t.entity_id, t.access_token);
    for (const t of cardTokens ?? []) tokenMap.set(t.entity_id, t.access_token);

    const linked = [
      ...(accounts ?? []).map((a) => ({ id: a.id, teller_account_id: a.teller_account_id, isCard: false })),
      ...(cards ?? []).map((c) => ({ id: c.id, teller_account_id: c.teller_account_id, isCard: true })),
    ];

    console.log("[sync-tx] Linked accounts to sync:", linked.length, linked.map(l => l.teller_account_id));

    if (!linked.length) {
      console.log("[sync-tx] No linked accounts, returning early");
      return new Response(JSON.stringify({ added: 0, message: "No linked accounts" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let totalAdded = 0;

    // Verify which account_ids actually exist in DB (avoid FK errors)
    const allEntityIds = linked.map(l => l.id);
    const { data: validAccounts } = await admin.from("accounts").select("id").in("id", allEntityIds);
    const { data: validCards } = await admin.from("credit_cards").select("id").in("id", allEntityIds);
    const validIds = new Set([
      ...(validAccounts ?? []).map(a => a.id),
      ...(validCards ?? []).map(c => c.id),
    ]);

    for (const row of linked) {
      const accessToken = tokenMap.get(row.id);
      if (!accessToken || !row.teller_account_id) {
        console.log("[sync-tx] Skipping row - no token or teller_account_id:", row.id);
        continue;
      }
      if (!validIds.has(row.id)) {
        console.log("[sync-tx] Skipping row - account_id not in DB:", row.id);
        continue;
      }

      try {
        console.log("[sync-tx] Fetching transactions for teller account:", row.teller_account_id);
        const transactions = await tellerFetch<TellerTransaction[]>(
          `/accounts/${row.teller_account_id}/transactions`, accessToken);

        if (!Array.isArray(transactions)) {
          console.error("[sync-tx] Unexpected response for account", row.id, ":", JSON.stringify(transactions).slice(0, 500));
          continue;
        }

        const posted = transactions.filter(tx => tx.status !== "pending");
        console.log("[sync-tx] Got", transactions.length, "from Teller,", posted.length, "posted for", row.teller_account_id);

        if (posted.length === 0) continue;

        // Build rows and batch upsert (ON CONFLICT now works with non-partial unique index)
        const rows = posted.map(tx => {
          const amount = parseFloat(tx.amount);
          const merchantName = tx.details?.counterparty?.name ?? null;
          const { category: catKey, txType } = classifyTellerTransaction(tx, merchantName);
          return {
            id: crypto.randomUUID(),
            user_id: user.id,
            account_id: row.isCard ? null : row.id,
            credit_card_id: row.isCard ? row.id : null,
            teller_transaction_id: tx.id,
            amount, date: tx.date, name: tx.description,
            merchant_name: merchantName, category: catKey,
            subcategory: null, transaction_type: txType, is_manual: false,
          };
        });

        // Batch upsert in chunks of 100, skip existing
        for (let i = 0; i < rows.length; i += 100) {
          const batch = rows.slice(i, i + 100);
          const { error: upsertErr, count } = await admin.from("transactions")
            .upsert(batch, { onConflict: "teller_transaction_id", ignoreDuplicates: true, count: "exact" });
          if (upsertErr) {
            console.error("[sync-tx] Batch upsert error:", upsertErr.message);
          } else {
            totalAdded += count ?? batch.length;
          }
        }
        console.log("[sync-tx] Done for", row.teller_account_id);
      } catch (e) {
        console.error("[sync-tx] Failed to sync for account", row.id, ":", e instanceof Error ? e.message : e);
        const msg = e instanceof Error ? e.message : String(e);
        if (linked.length === 1) {
          return new Response(JSON.stringify({ error: `Sync failed: ${msg.slice(0, 200)}` }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }
    }

    console.log("[sync-tx] Done! Total added:", totalAdded);
    return new Response(JSON.stringify({ added: totalAdded }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[sync-tx] Top-level error:", (err as Error).message, (err as Error).stack);
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
