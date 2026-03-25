"use client";

import { formatCurrency, getPercentage } from "@/lib/format";
import { PieChart, Landmark, TrendingUp, Bitcoin, Wallet } from "lucide-react";

interface Props {
  bankTotal: number;
  stockTotal: number;
  cryptoTotal: number;
  cashTotal: number;
  assetsTotal: number;
}

export default function AssetBreakdown({ bankTotal, stockTotal, cryptoTotal, cashTotal, assetsTotal }: Props) {
  const segments = [
    { label: "Bank", value: bankTotal, color: "#74b9ff", Icon: Landmark },
    { label: "Cash", value: cashTotal, color: "#2ecc71", Icon: Wallet },
    { label: "Stocks", value: stockTotal, color: "#00b894", Icon: TrendingUp },
    { label: "Crypto", value: cryptoTotal, color: "#fdcb6e", Icon: Bitcoin },
  ];

  // Build conic gradient
  let cumulative = 0;
  const gradientParts = segments.map((s) => {
    const pct = assetsTotal > 0 ? (s.value / assetsTotal) * 100 : 0;
    const start = cumulative;
    cumulative += pct;
    return `${s.color} ${start}% ${cumulative}%`;
  });
  const conicGradient = `conic-gradient(${gradientParts.join(", ")})`;

  return (
    <div className="rounded-2xl bg-card border border-border/50 p-4 sm:p-6 animate-slide-up">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2.5 rounded-xl bg-accent/20">
          <PieChart className="w-5 h-5 text-accent-light" />
        </div>
        <h2 className="text-lg font-bold text-foreground">Asset Breakdown</h2>
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-6 sm:gap-8">
        {/* Donut chart */}
        <div className="relative w-32 h-32 sm:w-36 sm:h-36 shrink-0">
          <div
            className="w-full h-full rounded-full"
            style={{ background: conicGradient }}
          />
          <div className="absolute inset-4 rounded-full bg-card flex items-center justify-center">
            <div className="text-center">
              <p className="text-[10px] sm:text-xs text-foreground/50">Total</p>
              <p className="text-xs sm:text-sm font-bold text-foreground">{formatCurrency(assetsTotal)}</p>
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="flex-1 w-full space-y-4">
          {segments.map((s) => {
            const pct = getPercentage(s.value, assetsTotal);
            return (
              <div key={s.label} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                    <s.Icon className="w-3.5 h-3.5 text-foreground/50 shrink-0" />
                    <span className="text-sm text-foreground/70">{s.label}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-semibold text-foreground">{formatCurrency(s.value)}</span>
                    <span className="text-xs text-foreground/40 w-10 text-right">{pct}%</span>
                  </div>
                </div>
                <div className="h-1.5 bg-background rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: s.color }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
