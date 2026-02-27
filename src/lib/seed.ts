import { getDb } from "./db";
import { v4 as uuid } from "uuid";

export function seedIfEmpty() {
  const db = getDb();
  const count = db.prepare("SELECT COUNT(*) as c FROM accounts").get() as { c: number };

  if (count.c > 0) return; // already seeded

  // Bank accounts
  const bankAccounts = [
    { name: "Chase Checking", balance: 4250.75, color: "#1a73e8", icon: "building" },
    { name: "Ally Savings", balance: 12800.00, color: "#00b894", icon: "piggy-bank" },
    { name: "Capital One 360", balance: 3420.50, color: "#e74c3c", icon: "landmark" },
  ];

  // Stock accounts
  const stockAccounts = [
    { name: "Fidelity 401k", balance: 45200.00, color: "#2d3436", icon: "trending-up" },
    { name: "Robinhood", balance: 8750.30, color: "#00d2d3", icon: "bar-chart-2" },
    { name: "Vanguard IRA", balance: 22100.00, color: "#6c5ce7", icon: "line-chart" },
  ];

  // Crypto accounts
  const cryptoAccounts = [
    { name: "Bitcoin (Coinbase)", balance: 15300.00, color: "#f39c12", icon: "bitcoin" },
    { name: "Ethereum (Ledger)", balance: 6200.00, color: "#636e72", icon: "hexagon" },
    { name: "Solana (Phantom)", balance: 2100.00, color: "#a29bfe", icon: "zap" },
  ];

  const insertAccount = db.prepare(
    "INSERT INTO accounts (id, name, type, balance, color, icon) VALUES (?, ?, ?, ?, ?, ?)"
  );

  for (const a of bankAccounts) {
    insertAccount.run(uuid(), a.name, "bank", a.balance, a.color, a.icon);
  }
  for (const a of stockAccounts) {
    insertAccount.run(uuid(), a.name, "stock", a.balance, a.color, a.icon);
  }
  for (const a of cryptoAccounts) {
    insertAccount.run(uuid(), a.name, "crypto", a.balance, a.color, a.icon);
  }

  // Credit cards
  const creditCards = [
    { name: "Chase Sapphire Reserve", balance_owed: 2340.50, credit_limit: 15000, points: 85000, pointsValue: 1.5, due_date: "2026-03-05", min_payment: 125, color: "#2d3436" },
    { name: "Amex Gold", balance_owed: 1180.25, credit_limit: 10000, points: 62000, pointsValue: 2.0, due_date: "2026-03-12", min_payment: 75, color: "#f1c40f" },
    { name: "Citi Double Cash", balance_owed: 520.00, credit_limit: 8000, points: 12400, pointsValue: 1.0, due_date: "2026-03-20", min_payment: 35, color: "#0984e3" },
  ];

  const insertCard = db.prepare(
    "INSERT INTO credit_cards (id, name, balance_owed, credit_limit, points_balance, points_value_cents, due_date, min_payment, color) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );

  for (const c of creditCards) {
    insertCard.run(uuid(), c.name, c.balance_owed, c.credit_limit, c.points, c.pointsValue, c.due_date, c.min_payment, c.color);
  }

  // Debts owed to user
  const debts = [
    { person: "Mike Johnson", amount: 500.00, reason: "Concert tickets", due_date: "2026-03-01" },
    { person: "Sarah Lee", amount: 150.00, reason: "Dinner split", due_date: null },
    { person: "Dave Chen", amount: 2000.00, reason: "Loan for car repair", due_date: "2026-04-15" },
    { person: "Emily Park", amount: 75.00, reason: "Uber rides", due_date: null },
  ];

  const insertDebt = db.prepare(
    "INSERT INTO debts_owed (id, person_name, amount, reason, due_date) VALUES (?, ?, ?, ?, ?)"
  );

  for (const d of debts) {
    insertDebt.run(uuid(), d.person, d.amount, d.reason, d.due_date);
  }
}
