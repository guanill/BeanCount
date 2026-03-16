import { NextResponse } from "next/server";
import { plaidClient } from "@/lib/plaid";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Find all accounts that have a Plaid integration token
    const { data: linked } = await supabaseAdmin
      .from("integration_tokens")
      .select("entity_id, access_token")
      .eq("user_id", user.id)
      .eq("provider", "plaid")
      .eq("entity_type", "account");

    if (!linked || linked.length === 0) {
      return NextResponse.json({ synced: 0 });
    }

    // Get the account details for these entities
    const entityIds = linked.map((r) => r.entity_id);
    const { data: accounts } = await supabaseAdmin
      .from("accounts")
      .select("id, plaid_account_id")
      .in("id", entityIds);

    if (!accounts || accounts.length === 0) {
      return NextResponse.json({ synced: 0 });
    }

    // Build lookup maps
    const tokenByEntityId = new Map(linked.map((r) => [r.entity_id, r.access_token]));
    const accountById = new Map(accounts.map((a) => [a.id, a]));

    // Group by access token (one item can have many accounts)
    const byToken = new Map<string, { id: string; plaid_account_id: string }[]>();
    for (const account of accounts) {
      const token = tokenByEntityId.get(account.id);
      if (!token) continue;
      const list = byToken.get(token) ?? [];
      list.push(account);
      byToken.set(token, list);
    }

    let synced = 0;

    for (const [accessToken, rows] of byToken.entries()) {
      const res = await plaidClient.accountsBalanceGet({ access_token: accessToken });

      for (const pa of res.data.accounts) {
        const matched = rows.find((r) => r.plaid_account_id === pa.account_id);
        if (!matched) continue;

        const balance = pa.balances.current ?? pa.balances.available ?? 0;
        await supabaseAdmin
          .from("accounts")
          .update({
            balance,
            plaid_last_synced: new Date().toISOString(),
          })
          .eq("id", matched.id);
        synced++;
      }
    }

    return NextResponse.json({ synced });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Plaid sync error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
