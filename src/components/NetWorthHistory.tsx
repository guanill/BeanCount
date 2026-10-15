"use client";

import { formatCurrency } from "@/lib/format";
import type { NetWorthSnapshot } from "@/lib/types";
import { TrendingDown, TrendingUp } from "lucide-react";

interface Props {
  snapshots: NetWorthSnapshot[];
}

export default function NetWorthHistory({ snapshots }: Props) {
  if (snapshots.length < 2) {
    return (
      <section className="rounded-2xl bg-card border border-border/50 p-5">
        <h2 className="text-lg font-bold text-foreground">Net worth history</h2>
        <p className="text-sm text-foreground/50 mt-2">
          Your daily trend will appear here after a second snapshot is recorded.
        </p>
      </section>
    );
  }

  const first = snapshots[0];
  const latest = snapshots[snapshots.length - 1];
  const change = latest.net_worth - first.net_worth;
  const positive = change >= 0;
  const values = snapshots.map((snapshot) => snapshot.net_worth);
  const min = Math.min(...values);
  const range = Math.max(...values) - min || 1;

  return (
    <section className="rounded-2xl bg-card border border-border/50 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h2 className="text-lg font-bold text-foreground">Net worth history</h2>
          <p className="text-xs text-foreground/40 mt-1">Daily snapshots · {snapshots.length} days</p>
        </div>
        <div className={`flex items-center gap-1 text-sm font-semibold ${positive ? "text-emerald-400" : "text-red-400"}`}>
          {positive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
          {positive ? "+" : ""}{formatCurrency(change)}
        </div>
      </div>
      <div className="h-28 flex items-end gap-1 sm:gap-1.5" aria-label="Net worth trend">
        {snapshots.map((snapshot) => (
          <div
            key={snapshot.id}
            title={`${snapshot.snapshot_date}: ${formatCurrency(snapshot.net_worth)}`}
            className="flex-1 min-w-0 rounded-t-sm bg-accent/70 hover:bg-accent transition-colors"
            style={{ height: `${Math.max(8, ((snapshot.net_worth - min) / range) * 92 + 8)}%` }}
          />
        ))}
      </div>
      <div className="flex justify-between mt-3 text-xs text-foreground/50">
        <span>{new Date(first.snapshot_date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
        <span className="font-semibold text-foreground">{formatCurrency(latest.net_worth)}</span>
        <span>{new Date(latest.snapshot_date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
      </div>
      <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-border/40 text-xs">
        <div><span className="text-foreground/50">Stocks</span><strong className="block text-foreground mt-1">{formatCurrency(latest.stock_total)}</strong></div>
        <div><span className="text-foreground/50">Crypto</span><strong className="block text-foreground mt-1">{formatCurrency(latest.crypto_total)}</strong></div>
      </div>
    </section>
  );
}
