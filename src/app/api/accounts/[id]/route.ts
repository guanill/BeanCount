import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { Account } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { name, type, balance, currency, icon, color } = body;
    const db = getDb();

    const existing = db.prepare("SELECT * FROM accounts WHERE id = ?").get(id) as Account | undefined;
    if (!existing) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    db.prepare(
      "UPDATE accounts SET name = ?, type = ?, balance = ?, currency = ?, icon = ?, color = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(
      name ?? existing.name,
      type ?? existing.type,
      balance ?? existing.balance,
      currency ?? existing.currency,
      icon ?? existing.icon,
      color ?? existing.color,
      id
    );

    const updated = db.prepare("SELECT * FROM accounts WHERE id = ?").get(id) as Account;
    return NextResponse.json(updated);
  } catch (error) {
    console.error("Update account error:", error);
    return NextResponse.json({ error: "Failed to update account" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const db = getDb();
    const result = db.prepare("DELETE FROM accounts WHERE id = ?").run(id);
    if (result.changes === 0) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete account error:", error);
    return NextResponse.json({ error: "Failed to delete account" }, { status: 500 });
  }
}
