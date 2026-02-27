import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { seedIfEmpty } from "@/lib/seed";
import type { Account, CreditCard, DebtOwed, Liability, DashboardData } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    seedIfEmpty();
    const db = getDb();

    const bankAccounts = db.prepare("SELECT * FROM accounts WHERE type = 'bank' ORDER BY balance DESC").all() as Account[];
    const stockAccounts = db.prepare("SELECT * FROM accounts WHERE type = 'stock' ORDER BY balance DESC").all() as Account[];
    const cryptoAccounts = db.prepare("SELECT * FROM accounts WHERE type = 'crypto' ORDER BY balance DESC").all() as Account[];
    const creditCards = db.prepare("SELECT * FROM credit_cards ORDER BY balance_owed DESC").all() as CreditCard[];
    const debtsOwed = db.prepare("SELECT * FROM debts_owed WHERE status != 'paid' ORDER BY amount DESC").all() as DebtOwed[];
    const liabilities = db.prepare("SELECT * FROM liabilities ORDER BY amount DESC").all() as Liability[];

    const bankTotal = bankAccounts.reduce((s, a) => s + a.balance, 0);
    const stockTotal = stockAccounts.reduce((s, a) => s + a.balance, 0);
    const cryptoTotal = cryptoAccounts.reduce((s, a) => s + a.balance, 0);
    const assetsTotal = bankTotal + stockTotal + cryptoTotal;
    const debtsOwedTotal = debtsOwed.reduce((s, d) => s + d.amount, 0);
    const creditCardDebt = creditCards.reduce((s, c) => s + c.balance_owed, 0);
    const liabilitiesTotal = liabilities.reduce((s, l) => s + l.amount, 0);
    const pointsValue = creditCards.reduce((s, c) => s + (c.points_balance * c.points_value_cents) / 100, 0);
    const netWorth = assetsTotal + debtsOwedTotal + pointsValue - creditCardDebt - liabilitiesTotal;

    const data: DashboardData = {
      accounts: { bank: bankAccounts, stock: stockAccounts, crypto: cryptoAccounts },
      creditCards,
      debtsOwed,
      liabilities,
      totals: {
        bankTotal,
        stockTotal,
        cryptoTotal,
        assetsTotal,
        debtsOwedTotal,
        creditCardDebt,
        liabilitiesTotal,
        pointsValue,
        netWorth,
      },
    };

    return NextResponse.json(data);
  } catch (error) {
    console.error("Dashboard API error:", error);
    return NextResponse.json({ error: "Failed to load dashboard data" }, { status: 500 });
  }
}
