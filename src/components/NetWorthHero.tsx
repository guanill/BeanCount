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
    <div className="relative overflow-hidden rounded-2xl bg-linear-to-br from-[#6c5ce7] via-[#5f3dc4] to-[#4c2aa6] p-8 shadow-2xl animate-fade-in">
      {/* Background decoration */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2" />
      <div className="absolute bottom-0 left-0 w-48 h-48 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2" />

      <div className="relative z-10">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-white/15 rounded-xl backdrop-blur-sm">
            <Wallet className="w-5 h-5 text-white" />
          </div>
          <span className="text-white/70 text-sm font-medium uppercase tracking-wider">Net Worth</span>
        </div>

        <div className="flex items-baseline gap-3 mb-6">
          <span className="text-5xl font-bold text-white tracking-tight">
            {formatCurrency(netWorth)}
          </span>
          <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold ${isPositive ? "bg-emerald-400/20 text-emerald-300" : "bg-red-400/20 text-red-300"}`}>
            {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {isPositive ? "Positive" : "Negative"}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4">
            <p className="text-white/60 text-xs uppercase tracking-wider mb-1">Total Assets</p>
            <p className="text-white text-xl font-bold">{formatCurrency(assetsTotal)}</p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4">
            <p className="text-white/60 text-xs uppercase tracking-wider mb-1">Total Liabilities</p>
            <p className="text-red-300 text-xl font-bold">-{formatCurrency(creditCardDebt + liabilitiesTotal)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
