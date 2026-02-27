import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { Loan } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const body = await req.json();
  const existing = db.prepare("SELECT * FROM loans WHERE id = ?").get(id) as Loan | undefined;
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  db.prepare(`
    UPDATE loans SET
      name            = ?,
      type            = ?,
      balance         = ?,
      original_amount = ?,
      interest_rate   = ?,
      monthly_payment = ?,
      notes           = ?,
      deferral_months = ?,
      deferral_type   = ?,
      updated_at      = datetime('now')
    WHERE id = ?
  `).run(
    body.name             ?? existing.name,
    body.type             ?? existing.type,
    body.balance          != null ? parseFloat(body.balance)          : existing.balance,
    body.original_amount  != null ? parseFloat(body.original_amount)  : existing.original_amount,
    body.interest_rate    != null ? parseFloat(body.interest_rate)    : existing.interest_rate,
    body.monthly_payment  != null ? parseFloat(body.monthly_payment)  : existing.monthly_payment,
    body.notes !== undefined ? body.notes : existing.notes,
    body.deferral_months  != null ? parseInt(body.deferral_months)    : (existing.deferral_months ?? 0),
    body.deferral_type    ?? existing.deferral_type ?? "unsubsidized",
    id,
  );

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  db.prepare("DELETE FROM loans WHERE id = ?").run(id);
  return NextResponse.json({ ok: true });
}
