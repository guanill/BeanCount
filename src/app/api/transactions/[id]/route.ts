import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  db.prepare("DELETE FROM transactions WHERE id = ? AND is_manual = 1").run(id);
  return NextResponse.json({ success: true });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const db = getDb();
  db.prepare(`
    UPDATE transactions SET
      name              = COALESCE(?, name),
      category          = COALESCE(?, category),
      transaction_type  = COALESCE(?, transaction_type),
      amount            = COALESCE(?, amount),
      notes             = COALESCE(?, notes)
    WHERE id = ?
  `).run(
    body.name    ?? null,
    body.category         ?? null,
    body.transaction_type ?? null,
    body.amount != null ? parseFloat(body.amount) : null,
    body.notes   ?? null,
    id,
  );
  return NextResponse.json({ success: true });
}
