"use client";

import { formatCurrency } from "@/lib/format";
import { Calculator, Plus, Minus, Equal } from "lucide-react";

interface Props {
  assetsTotal: number;
  debtsOwedTotal: number;
  pointsValue: number;
  creditCardDebt: number;
  liabilitiesTotal: number;
  netWorth: number;
}

export default function FinalTotals({ assetsTotal, debtsOwedTotal, pointsValue, creditCardDebt, liabilitiesTotal, netWorth }: Props) {
  const lines = [
    { label: "Total Assets", sub: "Bank, cash, stocks, crypto", value: assetsTotal, color: "text-foreground", icon: Plus, positive: true },
    { label: "Owed to You", sub: "Pending & partial", value: debtsOwedTotal, color: "text-green", icon: Plus, positive: true },
    { label: "Card Rewards", sub: "Points valuation", value: pointsValue, color: "text-yellow", icon: Plus, positive: true },
    { label: "Credit Cards", sub: "Current balances", value: creditCardDebt, color: "text-red", icon: Minus, positive: false },
    { label: "Pending & Owed", sub: "Liabilities", value: liabilitiesTotal, color: "text-red", icon: Minus, positive: false },
  ];

  return (
    <article className="surface-card p-5 sm:p-6">
      <header className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 rounded-lg bg-accent/12 border border-accent/20 flex items-center justify-center shrink-0">
          <Calculator className="w-4 h-4 text-accent-light" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-foreground tracking-tight">Net Worth Ledger</h2>
          <p className="text-xs text-foreground/45">How your net worth is calculated</p>
        </div>
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        {lines.map((line, i) => (
          <div key={i} className="rounded-xl bg-background/70 border border-border/80 p-3.5 flex flex-col justify-between min-w-0">
            <div className="flex items-center gap-1.5 text-xs text-foreground/55">
              <line.icon className={`w-3.5 h-3.5 shrink-0 ${line.positive ? "text-green" : "text-red"}`} />
              <span className="truncate font-medium">{line.label}</span>
            </div>
            <div className={`text-base font-bold tabular-nums mt-2 truncate ${line.color}`}>
              {line.positive ? "" : "−"}{formatCurrency(line.value)}
            </div>
            <div className="text-[11px] text-foreground/40 truncate mt-0.5">{line.sub}</div>
          </div>
        ))}

        <div className="col-span-2 sm:col-span-3 xl:col-span-1 rounded-xl bg-accent/12 border border-accent/30 p-3.5 flex flex-col justify-between min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-accent-light">
            <Equal className="w-3.5 h-3.5 shrink-0" />
            <span>Net Worth</span>
          </div>
          <div className={`text-lg font-bold tabular-nums mt-2 truncate ${netWorth >= 0 ? "text-green" : "text-red"}`}>
            {formatCurrency(netWorth)}
          </div>
          <div className="text-[11px] text-foreground/45 truncate mt-0.5">Total position</div>
        </div>
      </div>
    </article>
  );
}
