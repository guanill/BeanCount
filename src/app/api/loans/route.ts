import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM loans ORDER BY balance DESC").all();
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const db = getDb();
  const body = await req.json();
  const {
    name, type = "personal", balance, original_amount = null,
    interest_rate, monthly_payment, notes = null,
    deferral_months = 0, deferral_type = "unsubsidized",
  } = body;

  if (!name || balance == null || interest_rate == null || monthly_payment == null) {
    return NextResponse.json({ error: "name, balance, interest_rate, and monthly_payment are required" }, { status: 400 });
  }

  const id = randomUUID();
  db.prepare(`
    INSERT INTO loans (id, name, type, balance, original_amount, interest_rate, monthly_payment, notes, deferral_months, deferral_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, type, parseFloat(balance), original_amount ? parseFloat(original_amount) : null, parseFloat(interest_rate), parseFloat(monthly_payment), notes, parseInt(deferral_months) || 0, deferral_type);

  return NextResponse.json({ id });
}
