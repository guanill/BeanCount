import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { v4 as uuid } from "uuid";
import type { CreditCard } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDb();
  const cards = db.prepare("SELECT * FROM credit_cards ORDER BY balance_owed DESC").all() as CreditCard[];
  return NextResponse.json(cards);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, balance_owed = 0, credit_limit = 0, points_balance = 0, points_value_cents = 1, due_date, min_payment = 0, color } = body;

    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const id = uuid();
    const db = getDb();
    db.prepare(
      "INSERT INTO credit_cards (id, name, balance_owed, credit_limit, points_balance, points_value_cents, due_date, min_payment, color) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(id, name, balance_owed, credit_limit, points_balance, points_value_cents, due_date || null, min_payment, color || null);

    const card = db.prepare("SELECT * FROM credit_cards WHERE id = ?").get(id) as CreditCard;
    return NextResponse.json(card, { status: 201 });
  } catch (error) {
    console.error("Create credit card error:", error);
    return NextResponse.json({ error: "Failed to create credit card" }, { status: 500 });
  }
}
