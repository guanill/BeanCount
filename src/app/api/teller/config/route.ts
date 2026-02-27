import { NextResponse } from "next/server";
import { TELLER_APP_ID, TELLER_ENV } from "@/lib/teller";

// The client needs the app ID and environment to initialize Teller Connect
export async function GET() {
  if (!TELLER_APP_ID) {
    return NextResponse.json(
      { error: "TELLER_APP_ID is not configured" },
      { status: 500 }
    );
  }
  return NextResponse.json({ appId: TELLER_APP_ID, environment: TELLER_ENV });
}
