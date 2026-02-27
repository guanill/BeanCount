import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getCategoryMeta } from "@/lib/categories";
import { Transaction, TransactionSummary } from "@/lib/types";
import { v4 as uuidv4 } from "uuid";

/** GET /api/transactions?month=2&year=2026&category=food_and_drink&type=expense&q=starbucks */
export async function GET(req: NextRequest) {
  const db = getDb();
  const { searchParams } = new URL(req.url);

  const month  = searchParams.get("month");   // 1-12
  const year   = searchParams.get("year");
  const cat    = searchParams.get("category");
  const type   = searchParams.get("type");
  const q      = searchParams.get("q");

  const conditions: string[] = [];
  const params: unknown[]    = [];

  if (year && month) {
    const pad = month.padStart(2, "0");
    conditions.push("date LIKE ?");
    params.push(`${year}-${pad}-%`);
  } else if (year) {
    conditions.push("date LIKE ?");
    params.push(`${year}-%`);
  }
  if (cat)  { conditions.push("category = ?");          params.push(cat);  }
  if (type) { conditions.push("transaction_type = ?");  params.push(type); }
  if (q)    { conditions.push("(name LIKE ? OR merchant_name LIKE ?)"); params.push(`%${q}%`, `%${q}%`); }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const txRows = db
    .prepare(`SELECT * FROM transactions ${where} ORDER BY date DESC, created_at DESC LIMIT 500`)
    .all(...params) as Transaction[];

  // Build summary
  const allForPeriod = db
    .prepare(`SELECT amount, category, transaction_type FROM transactions ${where}`)
    .all(...params) as Pick<Transaction, "amount" | "category" | "transaction_type">[];

  let totalIncome   = 0;
  let totalExpenses = 0;
  const catMap = new Map<string, { amount: number; count: number }>();

  for (const tx of allForPeriod) {
    const absAmt = Math.abs(tx.amount);
    if (tx.transaction_type === "income") {
      totalIncome += absAmt;
    } else if (tx.transaction_type === "expense") {
      totalExpenses += absAmt;
    }
    const entry = catMap.get(tx.category) ?? { amount: 0, count: 0 };
    entry.amount += absAmt;
    entry.count  += 1;
    catMap.set(tx.category, entry);
  }

  const byCategory = Array.from(catMap.entries())
    .map(([category, { amount, count }]) => {
      const meta = getCategoryMeta(category);
      return { category, label: meta.label, color: meta.color, emoji: meta.emoji, amount, count, type: meta.type };
    })
    .sort((a, b) => b.amount - a.amount);

  const summary: TransactionSummary = {
    totalIncome,
    totalExpenses,
    net: totalIncome - totalExpenses,
    byCategory,
  };

  return NextResponse.json({ transactions: txRows, summary });
}

/** POST /api/transactions  — add a manual transaction */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const db   = getDb();

    const { guessCategory } = await import("@/lib/categories");
    const amount   = parseFloat(body.amount) || 0;
    const guessed  = guessCategory(body.name ?? "", amount);
    const category = body.category || guessed.category;
    const txType   = body.transaction_type || guessed.type;

    const id = uuidv4();
    db.prepare(`
      INSERT INTO transactions
        (id, account_id, amount, date, name, merchant_name, category, transaction_type, is_manual, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      id,
      body.account_id ?? null,
      amount,
      body.date ?? new Date().toISOString().slice(0, 10),
      body.name ?? "Manual transaction",
      body.merchant_name ?? null,
      category,
      txType,
      body.notes ?? null,
    );

    return NextResponse.json({ success: true, id });
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
