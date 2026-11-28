"use client";

import { formatCurrency } from "@/lib/format";
import { TrendingUp, TrendingDown, Wallet, Landmark, CreditCard } from "lucide-react";

interface Props {
  netWorth: number;
  liquidTotal: number;
  investmentsTotal: number;
  creditCardDebt: number;
  liabilitiesTotal?: number;
  debtsOwedTotal?: number;
  pointsValue?: number;
}

export default function NetWorthHero({
  netWorth,
  liquidTotal,
  investmentsTotal,
  creditCardDebt,
  liabilitiesTotal = 0,
  debtsOwedTotal = 0,
  pointsValue = 0,
}: Props) {
  const isPositive = netWorth >= 0;
  const totalObligations = creditCardDebt + liabilitiesTotal;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 animate-fade-in">
      {/* 1. Net Worth */}
      <article className="surface-card p-5 flex flex-col justify-between border-accent/35 bg-linear-to-br from-accent/10 via-card to-card">
        <header className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-accent/15 border border-accent/25 flex items-center justify-center">
              <Wallet className="w-4 h-4 text-accent-light" />
            </div>
            <h2 className="text-xs font-medium text-foreground/60 uppercase tracking-wider">Net Worth</h2>
          </div>
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${isPositive ? "bg-green/12 text-green" : "bg-red/12 text-red"}`}>
            {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {isPositive ? "Positive" : "Negative"}
          </span>
        </header>
        <div className="mt-4">
          <p className="fluid-hero-value font-bold text-foreground tracking-tight tabular-nums truncate">
            {formatCurrency(netWorth)}
          </p>
          <p className="text-xs text-foreground/45 mt-1 tabular-nums">
            +{formatCurrency(debtsOwedTotal)} owed · +{formatCurrency(pointsValue)} rewards
          </p>
        </div>
      </article>

      {/* 2. Liquid Cash (Bank + Cash — spendable now) */}
      <article className="surface-card p-5 flex flex-col justify-between">
        <header className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue/12 border border-blue/25 flex items-center justify-center">
            <Landmark className="w-4 h-4 text-blue" />
          </div>
          <h2 className="text-xs font-medium text-foreground/55 uppercase tracking-wider">Liquid Cash</h2>
        </header>
        <div className="mt-4">
          <p className="text-2xl font-bold text-foreground tracking-tight tabular-nums truncate">
            {formatCurrency(liquidTotal)}
          </p>
          <p className="text-xs text-foreground/45 mt-1">Bank & cash available today</p>
        </div>
      </article>

      {/* 3. Investments (Stocks + Crypto) */}
      <article className="surface-card p-5 flex flex-col justify-between">
        <header className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-green/12 border border-green/25 flex items-center justify-center">
            <TrendingUp className="w-4 h-4 text-green" />
          </div>
          <h2 className="text-xs font-medium text-foreground/55 uppercase tracking-wider">Investments</h2>
        </header>
        <div className="mt-4">
          <p className="text-2xl font-bold text-foreground tracking-tight tabular-nums truncate">
            {formatCurrency(investmentsTotal)}
          </p>
          <p className="text-xs text-foreground/45 mt-1">Equities & crypto holdings</p>
        </div>
      </article>

      {/* 4. Cards & Pending */}
      <article className="surface-card p-5 flex flex-col justify-between">
        <header className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-red/12 border border-red/25 flex items-center justify-center">
            <CreditCard className="w-4 h-4 text-red" />
          </div>
          <h2 className="text-xs font-medium text-foreground/55 uppercase tracking-wider">Cards & Pending</h2>
        </header>
        <div className="mt-4">
          <p className={`text-2xl font-bold tracking-tight tabular-nums truncate ${totalObligations > 0 ? "text-red" : "text-foreground"}`}>
            {totalObligations > 0 ? `−${formatCurrency(totalObligations)}` : formatCurrency(0)}
          </p>
          <p className="text-xs text-foreground/45 mt-1 tabular-nums">
            {formatCurrency(creditCardDebt)} cards · {formatCurrency(liabilitiesTotal)} pending
          </p>
        </div>
      </article>
    </div>
  );
}
