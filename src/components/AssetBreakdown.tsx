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
    { label: "Bank", value: bankTotal, color: "#38bdf8", Icon: Landmark },
    { label: "Cash", value: cashTotal, color: "#10b981", Icon: Wallet },
    { label: "Stocks", value: stockTotal, color: "#7c6cf0", Icon: TrendingUp },
    { label: "Crypto", value: cryptoTotal, color: "#f59e0b", Icon: Bitcoin },
  ];

  let cumulative = 0;
  const gradientParts = segments.map((s) => {
    const pct = assetsTotal > 0 ? (s.value / assetsTotal) * 100 : 0;
    const start = cumulative;
    cumulative += pct;
    return `${s.color} ${start}% ${cumulative}%`;
  });
  const conicGradient = assetsTotal > 0 ? `conic-gradient(${gradientParts.join(", ")})` : "conic-gradient(#232736 0% 100%)";

  return (
    <article className="surface-card cq-card h-full flex flex-col justify-between p-5 sm:p-6">
      <header className="flex items-center gap-3 mb-5">
        <div className="w-9 h-9 rounded-lg bg-accent/12 border border-accent/20 flex items-center justify-center shrink-0">
          <PieChart className="w-4 h-4 text-accent-light" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-foreground tracking-tight">Asset Allocation</h2>
          <p className="text-xs text-foreground/45">Share of {formatCurrency(assetsTotal)}</p>
        </div>
      </header>

      <div className="cq-asset-layout flex-1 items-center">
        <div className="relative w-32 h-32 shrink-0">
          <div className="w-full h-full rounded-full" style={{ background: conicGradient }} />
          <div className="absolute inset-4 rounded-full bg-card flex items-center justify-center border border-border/60">
            <div className="text-center px-1">
              <p className="text-[10px] text-foreground/45">Assets</p>
              <p className="text-xs font-bold text-foreground tabular-nums">{formatCurrency(assetsTotal)}</p>
            </div>
          </div>
        </div>

        <div className="flex-1 w-full min-w-0 space-y-3">
          {segments.map((s) => {
            const pct = getPercentage(s.value, assetsTotal);
            return (
              <div key={s.label} className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="text-xs font-medium text-foreground/75 truncate">{s.label}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 tabular-nums">
                    <span className="text-xs font-semibold text-foreground">{formatCurrency(s.value)}</span>
                    <span className="text-[11px] text-foreground/40 w-8 text-right">{pct}%</span>
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
    </article>
  );
}
