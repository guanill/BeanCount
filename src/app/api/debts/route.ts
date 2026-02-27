import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { v4 as uuid } from "uuid";
import type { DebtOwed } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDb();
  const debts = db.prepare("SELECT * FROM debts_owed ORDER BY status ASC, amount DESC").all() as DebtOwed[];
  return NextResponse.json(debts);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { person_name, amount, reason, due_date } = body;

    if (!person_name || !amount) {
      return NextResponse.json({ error: "person_name and amount are required" }, { status: 400 });
    }

    const id = uuid();
    const db = getDb();
    db.prepare(
      "INSERT INTO debts_owed (id, person_name, amount, reason, due_date) VALUES (?, ?, ?, ?, ?)"
    ).run(id, person_name, amount, reason || null, due_date || null);

    const debt = db.prepare("SELECT * FROM debts_owed WHERE id = ?").get(id) as DebtOwed;
    return NextResponse.json(debt, { status: 201 });
  } catch (error) {
    console.error("Create debt error:", error);
    return NextResponse.json({ error: "Failed to create debt" }, { status: 500 });
  }
}
