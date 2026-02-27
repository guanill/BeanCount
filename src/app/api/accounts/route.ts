import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { v4 as uuid } from "uuid";
import type { Account } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDb();
  const accounts = db.prepare("SELECT * FROM accounts ORDER BY type, balance DESC").all() as Account[];
  return NextResponse.json(accounts);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, type, balance, currency = "USD", icon, color } = body;

    if (!name || !type) {
      return NextResponse.json({ error: "name and type are required" }, { status: 400 });
    }

    const id = uuid();
    const db = getDb();
    db.prepare(
      "INSERT INTO accounts (id, name, type, balance, currency, icon, color) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(id, name, type, balance || 0, currency, icon || null, color || null);

    const account = db.prepare("SELECT * FROM accounts WHERE id = ?").get(id) as Account;
    return NextResponse.json(account, { status: 201 });
  } catch (error) {
    console.error("Create account error:", error);
    return NextResponse.json({ error: "Failed to create account" }, { status: 500 });
  }
}
