"use client";

import { formatCurrency } from "@/lib/format";
import { TrendingUp, TrendingDown, Wallet } from "lucide-react";

interface Props {
  netWorth: number;
  assetsTotal: number;
  creditCardDebt: number;
  liabilitiesTotal?: number;
}

export default function NetWorthHero({ netWorth, assetsTotal, creditCardDebt, liabilitiesTotal = 0 }: Props) {
  const isPositive = netWorth >= 0;

  return (
    <div className="relative h-full flex flex-col justify-between overflow-hidden rounded-2xl bg-linear-to-br from-[#6c5ce7] via-[#5f3dc4] to-[#4c2aa6] p-5 sm:p-6 shadow-2xl animate-fade-in">
      {/* Background decoration */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2 pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-48 h-48 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2 pointer-events-none" />

      <div className="relative z-10 flex-1 flex flex-col justify-between gap-5">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-white/15 rounded-xl backdrop-blur-sm">
              <Wallet className="w-5 h-5 text-white" />
            </div>
            <span className="text-white/75 text-xs sm:text-sm font-medium uppercase tracking-wider">Net Worth</span>
          </div>

          <div className="flex flex-wrap items-baseline gap-2 sm:gap-3">
            <span className="fluid-hero-value font-bold text-white tracking-tight tabular-nums">
              {formatCurrency(netWorth)}
            </span>
            <div className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold shrink-0 ${isPositive ? "bg-emerald-400/20 text-emerald-300" : "bg-red-400/20 text-red-300"}`}>
              {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {isPositive ? "Positive" : "Negative"}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 sm:p-3.5">
            <p className="text-white/65 text-[10px] sm:text-xs uppercase tracking-wider mb-1">Total Assets</p>
            <p className="text-white text-base sm:text-lg font-bold tabular-nums truncate">{formatCurrency(assetsTotal)}</p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 sm:p-3.5">
            <p className="text-white/65 text-[10px] sm:text-xs uppercase tracking-wider mb-1">Total Liabilities</p>
            <p className="text-red-300 text-base sm:text-lg font-bold tabular-nums truncate">-{formatCurrency(creditCardDebt + liabilitiesTotal)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
