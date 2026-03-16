import { NextRequest, NextResponse } from "next/server";
import { plaidClient } from "@/lib/plaid";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { v4 as uuidv4 } from "uuid";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { public_token, institution_name } = await req.json();

    // Exchange public token for access token
    const exchangeRes = await plaidClient.itemPublicTokenExchange({ public_token });
    const accessToken = exchangeRes.data.access_token;
    const itemId = exchangeRes.data.item_id;

    // Fetch accounts + balances from Plaid
    const balanceRes = await plaidClient.accountsBalanceGet({ access_token: accessToken });
    const plaidAccounts = balanceRes.data.accounts;

    const created: object[] = [];

    for (const pa of plaidAccounts) {
      // Skip investment / loan sub-types for now — only depository
      const subtypeMap: Record<string, string> = {
        checking: "bank",
        savings: "bank",
        "money market": "bank",
        brokerage: "stock",
        "401k": "stock",
        ira: "stock",
      };
      const accountType =
        subtypeMap[pa.subtype as string] ??
        (pa.type === "investment" ? "stock" : "bank");

      const balance = pa.balances.current ?? pa.balances.available ?? 0;
      const name = `${institution_name} – ${pa.name}`;

      // Check if this plaid_account_id is already tracked
      const { data: existing } = await supabaseAdmin
        .from("accounts")
        .select("id")
        .eq("plaid_account_id", pa.account_id)
        .eq("user_id", user.id)
        .maybeSingle();

      if (existing) {
        // Update balance
        await supabaseAdmin
          .from("accounts")
          .update({
            balance,
            plaid_item_id: itemId,
            plaid_institution_name: institution_name,
            plaid_last_synced: new Date().toISOString(),
          })
          .eq("id", existing.id);

        // Upsert access token in integration_tokens
        await supabaseAdmin
          .from("integration_tokens")
          .upsert(
            {
              user_id: user.id,
              provider: "plaid",
              entity_type: "account",
              entity_id: existing.id,
              access_token: accessToken,
            },
            { onConflict: "provider,entity_type,entity_id" }
          );

        created.push({ id: existing.id, name, balance, updated: true });
      } else {
        // Insert new account
        const id = uuidv4();
        await supabaseAdmin
          .from("accounts")
          .insert({
            id,
            user_id: user.id,
            name,
            type: accountType,
            balance,
            icon: "landmark",
            color: "#4a9eed",
            plaid_account_id: pa.account_id,
            plaid_item_id: itemId,
            plaid_institution_name: institution_name,
            plaid_last_synced: new Date().toISOString(),
          });

        // Store access token in integration_tokens
        await supabaseAdmin
          .from("integration_tokens")
          .insert({
            user_id: user.id,
            provider: "plaid",
            entity_type: "account",
            entity_id: id,
            access_token: accessToken,
          });

        created.push({ id, name, balance, updated: false });
      }
    }

    return NextResponse.json({ success: true, accounts: created });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Plaid exchange-token error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
