import { NextResponse } from "next/server";
import { plaidClient } from "@/lib/plaid";
import { CountryCode, Products } from "plaid";

export async function POST() {
  try {
    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: "budget-app-user" },
      client_name: "Budget Tracker",
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: "en",
    });

    return NextResponse.json({ link_token: response.data.link_token });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Plaid create-link-token error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
