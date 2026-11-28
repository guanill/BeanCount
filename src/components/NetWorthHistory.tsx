"use client";

import { formatCurrency } from "@/lib/format";
import type { NetWorthSnapshot } from "@/lib/types";
import { LineChart, TrendingDown, TrendingUp } from "lucide-react";

interface Props {
  snapshots: NetWorthSnapshot[];
}

export default function NetWorthHistory({ snapshots }: Props) {
  if (snapshots.length < 2) {
    return (
      <article className="surface-card h-full flex flex-col justify-between p-5 sm:p-6">
        <header className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-accent/12 border border-accent/20 flex items-center justify-center shrink-0">
            <LineChart className="w-4 h-4 text-accent-light" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground tracking-tight">Net Worth History</h2>
            <p className="text-xs text-foreground/45">Daily trajectory</p>
          </div>
        </header>
        <p className="text-sm text-foreground/45 mt-6">
          Your daily trend will appear here once a second daily snapshot is recorded.
        </p>
      </article>
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
    <article className="surface-card h-full flex flex-col justify-between p-5 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-accent/12 border border-accent/20 flex items-center justify-center shrink-0">
            <LineChart className="w-4 h-4 text-accent-light" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground tracking-tight">Net Worth History</h2>
            <p className="text-xs text-foreground/45">{snapshots.length} daily snapshots</p>
          </div>
        </div>
        <div className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold tabular-nums ${positive ? "bg-green/12 text-green" : "bg-red/12 text-red"}`}>
          {positive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
          {positive ? "+" : ""}{formatCurrency(change)}
        </div>
      </header>

      <div>
        <div className="h-32 flex items-end gap-1 sm:gap-1.5" aria-label="Net worth trend">
          {snapshots.map((snapshot) => (
            <div
              key={snapshot.id}
              title={`${snapshot.snapshot_date}: ${formatCurrency(snapshot.net_worth)}`}
              className="flex-1 min-w-0 rounded-t-sm bg-accent/65 hover:bg-accent-light transition-colors"
              style={{ height: `${Math.max(10, ((snapshot.net_worth - min) / range) * 90 + 10)}%` }}
            />
          ))}
        </div>
        <div className="flex justify-between mt-3 text-xs text-foreground/45 tabular-nums">
          <span>{new Date(first.snapshot_date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
          <span className="font-semibold text-foreground/85">{formatCurrency(latest.net_worth)}</span>
          <span>{new Date(latest.snapshot_date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
        </div>
      </div>

      <footer className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-border text-xs tabular-nums">
        <div>
          <span className="text-foreground/45">Stocks snapshot</span>
          <strong className="block text-foreground font-semibold mt-0.5">{formatCurrency(latest.stock_total)}</strong>
        </div>
        <div>
          <span className="text-foreground/45">Crypto snapshot</span>
          <strong className="block text-foreground font-semibold mt-0.5">{formatCurrency(latest.crypto_total)}</strong>
        </div>
      </footer>
    </article>
  );
}
