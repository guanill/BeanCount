import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { DebtOwed } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const db = getDb();

    const existing = db.prepare("SELECT * FROM debts_owed WHERE id = ?").get(id) as DebtOwed | undefined;
    if (!existing) {
      return NextResponse.json({ error: "Debt not found" }, { status: 404 });
    }

    db.prepare(
      "UPDATE debts_owed SET person_name = ?, amount = ?, reason = ?, due_date = ?, status = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(
      body.person_name ?? existing.person_name,
      body.amount ?? existing.amount,
      body.reason ?? existing.reason,
      body.due_date ?? existing.due_date,
      body.status ?? existing.status,
      id
    );

    const updated = db.prepare("SELECT * FROM debts_owed WHERE id = ?").get(id) as DebtOwed;
    return NextResponse.json(updated);
  } catch (error) {
    console.error("Update debt error:", error);
    return NextResponse.json({ error: "Failed to update debt" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const db = getDb();
    const result = db.prepare("DELETE FROM debts_owed WHERE id = ?").run(id);
    if (result.changes === 0) {
      return NextResponse.json({ error: "Debt not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete debt error:", error);
    return NextResponse.json({ error: "Failed to delete debt" }, { status: 500 });
  }
}
