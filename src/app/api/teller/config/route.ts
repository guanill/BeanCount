import { NextResponse } from "next/server";
import { TELLER_APP_ID, TELLER_ENV } from "@/lib/teller";
import { createClient } from "@/lib/supabase/server";

// The client needs the app ID and environment to initialize Teller Connect
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!TELLER_APP_ID) {
    return NextResponse.json(
      { error: "TELLER_APP_ID is not configured" },
      { status: 500 }
    );
  }
  return NextResponse.json({ appId: TELLER_APP_ID, environment: TELLER_ENV });
}
