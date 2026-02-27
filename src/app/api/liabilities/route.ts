import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM liabilities ORDER BY amount DESC").all();
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const db = getDb();
  const body = await req.json();
  const { name, amount, category = "other", notes = null, due_date = null } = body;

  if (!name || amount == null) {
    return NextResponse.json({ error: "name and amount are required" }, { status: 400 });
  }

  const id = randomUUID();
  db.prepare(`
    INSERT INTO liabilities (id, name, amount, category, notes, due_date)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, name, parseFloat(amount) || 0, category, notes, due_date);

  return NextResponse.json({ id });
}
