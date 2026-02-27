import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const body = await req.json();
  const { name, amount, category, notes, due_date } = body;

  const existing = db.prepare("SELECT * FROM liabilities WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  db.prepare(`
    UPDATE liabilities SET
      name     = ?,
      amount   = ?,
      category = ?,
      notes    = ?,
      due_date = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    name     ?? existing.name,
    amount   != null ? parseFloat(amount) : existing.amount,
    category ?? existing.category,
    notes    !== undefined ? notes    : existing.notes,
    due_date !== undefined ? due_date : existing.due_date,
    id,
  );

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  db.prepare("DELETE FROM liabilities WHERE id = ?").run(id);
  return NextResponse.json({ ok: true });
}
