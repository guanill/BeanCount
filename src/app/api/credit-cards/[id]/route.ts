import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { CreditCard } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const db = getDb();

    const existing = db.prepare("SELECT * FROM credit_cards WHERE id = ?").get(id) as CreditCard | undefined;
    if (!existing) {
      return NextResponse.json({ error: "Credit card not found" }, { status: 404 });
    }

    db.prepare(
      `UPDATE credit_cards SET name = ?, balance_owed = ?, credit_limit = ?, points_balance = ?, 
       points_value_cents = ?, due_date = ?, min_payment = ?, color = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(
      body.name ?? existing.name,
      body.balance_owed ?? existing.balance_owed,
      body.credit_limit ?? existing.credit_limit,
      body.points_balance ?? existing.points_balance,
      body.points_value_cents ?? existing.points_value_cents,
      body.due_date ?? existing.due_date,
      body.min_payment ?? existing.min_payment,
      body.color ?? existing.color,
      id
    );

    const updated = db.prepare("SELECT * FROM credit_cards WHERE id = ?").get(id) as CreditCard;
    return NextResponse.json(updated);
  } catch (error) {
    console.error("Update credit card error:", error);
    return NextResponse.json({ error: "Failed to update credit card" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const db = getDb();
    const result = db.prepare("DELETE FROM credit_cards WHERE id = ?").run(id);
    if (result.changes === 0) {
      return NextResponse.json({ error: "Credit card not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete credit card error:", error);
    return NextResponse.json({ error: "Failed to delete credit card" }, { status: 500 });
  }
}
