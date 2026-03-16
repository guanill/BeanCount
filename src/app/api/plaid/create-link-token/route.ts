import { NextResponse } from "next/server";
import { plaidClient } from "@/lib/plaid";
import { CountryCode, Products } from "plaid";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: user.id },
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
