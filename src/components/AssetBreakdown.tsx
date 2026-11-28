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
    <div className="cq-card h-full flex flex-col justify-between rounded-2xl bg-card border border-border/50 p-5 animate-slide-up">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="p-2 rounded-xl bg-accent/20">
          <PieChart className="w-4 h-4 text-accent-light" />
        </div>
        <h2 className="text-base font-bold text-foreground">Asset Breakdown</h2>
      </div>

      <div className="cq-asset-layout flex-1 justify-center">
        {/* Donut chart */}
        <div className="relative w-28 h-28 shrink-0">
          <div
            className="w-full h-full rounded-full"
            style={{ background: conicGradient }}
          />
          <div className="absolute inset-3.5 rounded-full bg-card flex items-center justify-center">
            <div className="text-center px-1">
              <p className="text-[10px] text-foreground/50">Total</p>
              <p className="text-[11px] font-bold text-foreground tabular-nums">{formatCurrency(assetsTotal)}</p>
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="flex-1 w-full min-w-0 space-y-2.5">
          {segments.map((s) => {
            const pct = getPercentage(s.value, assetsTotal);
            return (
              <div key={s.label} className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                    <s.Icon className="w-3 h-3 text-foreground/50 shrink-0" />
                    <span className="text-xs text-foreground/70 truncate">{s.label}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 tabular-nums">
                    <span className="text-xs font-semibold text-foreground">{formatCurrency(s.value)}</span>
                    <span className="text-[10px] text-foreground/40 w-8 text-right">{pct}%</span>
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
