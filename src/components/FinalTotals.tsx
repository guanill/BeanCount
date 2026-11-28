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
    { label: "Total Assets", sub: "Bank, Cash, Stocks, Crypto", value: assetsTotal, color: "text-blue", icon: Plus, positive: true },
    { label: "Owed to You", sub: "Pending & partial", value: debtsOwedTotal, color: "text-green", icon: Plus, positive: true },
    { label: "Card Points", sub: "Estimated value", value: pointsValue, color: "text-yellow", icon: Plus, positive: true },
    { label: "Card Debt", sub: "Balances owed", value: creditCardDebt, color: "text-red", icon: Minus, positive: false },
    { label: "Liabilities", sub: "Pending & owed", value: liabilitiesTotal, color: "text-red", icon: Minus, positive: false },
  ];

  return (
    <div className="rounded-2xl bg-card border border-border/50 p-5 animate-slide-up">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="p-2 rounded-xl bg-accent/20">
          <Calculator className="w-4 h-4 text-accent-light" />
        </div>
        <h2 className="text-base font-bold text-foreground">Net Worth Equation</h2>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2.5">
        {lines.map((line, i) => (
          <div key={i} className="rounded-xl bg-background/60 border border-border/30 p-3 flex flex-col justify-between min-w-0">
            <div className="flex items-center gap-1.5 text-xs text-foreground/60">
              <line.icon className={`w-3.5 h-3.5 shrink-0 ${line.positive ? "text-green" : "text-red"}`} />
              <span className="truncate font-medium">{line.label}</span>
            </div>
            <div className={`text-base font-bold tabular-nums mt-2 truncate ${line.color}`}>
              {line.positive ? "" : "-"}{formatCurrency(line.value)}
            </div>
            <div className="text-[10px] text-foreground/35 truncate mt-0.5">{line.sub}</div>
          </div>
        ))}

        {/* Net worth result tile */}
        <div className="col-span-2 sm:col-span-3 xl:col-span-1 rounded-xl bg-accent/15 border border-accent/30 p-3 flex flex-col justify-between min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-accent-light">
            <Equal className="w-3.5 h-3.5 shrink-0" />
            <span>NET WORTH</span>
          </div>
          <div className={`text-lg font-black tabular-nums mt-2 truncate ${netWorth >= 0 ? "text-green" : "text-red"}`}>
            {formatCurrency(netWorth)}
          </div>
          <div className="text-[10px] text-foreground/40 truncate mt-0.5">Total position</div>
        </div>
      </div>
    </div>
  );
}
