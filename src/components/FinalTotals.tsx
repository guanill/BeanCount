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
    { label: "Total Assets (Bank + Stocks + Crypto)", value: assetsTotal, color: "text-blue", icon: Plus, positive: true },
    { label: "Owed to You", value: debtsOwedTotal, color: "text-green", icon: Plus, positive: true },
    { label: "Credit Card Points Value", value: pointsValue, color: "text-yellow", icon: Plus, positive: true },
    { label: "Credit Card Debt", value: creditCardDebt, color: "text-red", icon: Minus, positive: false },
    { label: "Pending & Owed", value: liabilitiesTotal, color: "text-red", icon: Minus, positive: false },
  ];

  return (
    <div className="rounded-2xl bg-card border border-border/50 p-6 animate-slide-up">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2.5 rounded-xl bg-accent/20">
          <Calculator className="w-5 h-5 text-accent-light" />
        </div>
        <h2 className="text-lg font-bold text-foreground">Final Summary</h2>
      </div>

      <div className="space-y-3">
        {lines.map((line, i) => (
          <div key={i} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
            <div className="flex items-center gap-2">
              <line.icon className={`w-4 h-4 ${line.positive ? "text-green" : "text-red"}`} />
              <span className="text-sm text-foreground/70">{line.label}</span>
            </div>
            <span className={`text-sm font-bold ${line.color}`}>
              {line.positive ? "" : "-"}{formatCurrency(line.value)}
            </span>
          </div>
        ))}

        {/* Divider */}
        <div className="border-t-2 border-accent/30 my-2" />

        {/* Net worth */}
        <div className="flex items-center justify-between py-3 px-4 rounded-xl bg-accent/10 border border-accent/20">
          <div className="flex items-center gap-2">
            <Equal className="w-5 h-5 text-accent-light" />
            <span className="text-base font-bold text-foreground">NET WORTH</span>
          </div>
          <span className={`text-2xl font-black ${netWorth >= 0 ? "text-green" : "text-red"}`}>
            {formatCurrency(netWorth)}
          </span>
        </div>
      </div>
    </div>
  );
}
