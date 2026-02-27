"use client";

import { useState, useEffect, useCallback } from "react";
import { DashboardData } from "@/lib/types";
import NetWorthHero from "./NetWorthHero";
import AccountSection from "./AccountSection";
import CreditCardsSection from "./CreditCardsSection";
import DebtsSection from "./DebtsSection";
import AssetBreakdown from "./AssetBreakdown";
import FinalTotals from "./FinalTotals";
import TransactionsSection from "./TransactionsSection";
import PlannerSection from "./PlannerSection";
import LoansSection from "./LoansSection";
import { RefreshCw, Activity, LayoutDashboard, Receipt, Sparkles, Landmark } from "lucide-react";

type View = "overview" | "spending" | "planner" | "loans";

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<View>("overview");

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard");
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error("Failed to fetch dashboard:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-accent/30 border-t-accent rounded-full animate-spin" />
          <p className="text-foreground/50 text-sm">Loading your finances...</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-red text-lg">Failed to load dashboard data</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-background/80 border-b border-border/50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-accent rounded-xl glow-pulse">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight">WealthPulse</h1>
              <p className="text-xs text-foreground/40">Personal Finance Dashboard</p>
            </div>
          </div>

          {/* Tab switcher */}
          <div className="flex items-center gap-1 bg-card border border-border/50 rounded-xl p-1">
            <button
              onClick={() => setView("overview")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                view === "overview"
                  ? "bg-accent text-white shadow-sm"
                  : "text-foreground/50 hover:text-foreground"
              }`}
            >
              <LayoutDashboard className="w-4 h-4" />
              Overview
            </button>
            <button
              onClick={() => setView("spending")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                view === "spending"
                  ? "bg-accent text-white shadow-sm"
                  : "text-foreground/50 hover:text-foreground"
              }`}
            >
              <Receipt className="w-4 h-4" />
              Spending
            </button>
            <button
              onClick={() => setView("planner")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                view === "planner"
                  ? "bg-accent text-white shadow-sm"
                  : "text-foreground/50 hover:text-foreground"
              }`}
            >
              <Sparkles className="w-4 h-4" />
              Planner
            </button>
            <button
              onClick={() => setView("loans")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                view === "loans"
                  ? "bg-accent text-white shadow-sm"
                  : "text-foreground/50 hover:text-foreground"
              }`}
            >
              <Landmark className="w-4 h-4" />
              Loans
            </button>
          </div>

          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 bg-card hover:bg-card-hover border border-border/50 rounded-xl text-sm text-foreground/70 hover:text-foreground transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {view === "overview" ? (
          <>
            {/* Hero - Net Worth */}
            <NetWorthHero
              netWorth={data.totals.netWorth}
              assetsTotal={data.totals.assetsTotal}
              creditCardDebt={data.totals.creditCardDebt}
            />

            {/* Asset Breakdown + Accounts Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <AccountSection
                type="bank"
                accounts={data.accounts.bank}
                total={data.totals.bankTotal}
                onRefresh={handleRefresh}
              />
              <AccountSection
                type="stock"
                accounts={data.accounts.stock}
                total={data.totals.stockTotal}
                onRefresh={handleRefresh}
              />
              <AccountSection
                type="crypto"
                accounts={data.accounts.crypto}
                total={data.totals.cryptoTotal}
                onRefresh={handleRefresh}
              />
            </div>

            {/* Asset Breakdown Donut */}
            <AssetBreakdown
              bankTotal={data.totals.bankTotal}
              stockTotal={data.totals.stockTotal}
              cryptoTotal={data.totals.cryptoTotal}
              assetsTotal={data.totals.assetsTotal}
            />

            {/* Credit Cards + Debts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <CreditCardsSection
                cards={data.creditCards}
                totalDebt={data.totals.creditCardDebt}
                totalPointsValue={data.totals.pointsValue}
                onRefresh={handleRefresh}
              />
              <DebtsSection
                debts={data.debtsOwed}
                total={data.totals.debtsOwedTotal}
                onRefresh={handleRefresh}
              />
            </div>

            {/* Final Summary */}
            <FinalTotals
              assetsTotal={data.totals.assetsTotal}
              debtsOwedTotal={data.totals.debtsOwedTotal}
              pointsValue={data.totals.pointsValue}
              creditCardDebt={data.totals.creditCardDebt}
              netWorth={data.totals.netWorth}
            />
          </>
        ) : view === "spending" ? (
          <TransactionsSection />
        ) : view === "loans" ? (
          <LoansSection />
        ) : (
          <PlannerSection netWorth={data.totals.netWorth} stockTotal={data.totals.stockTotal} />
        )}

        {/* Footer */}
        <footer className="text-center py-6 text-foreground/20 text-xs">
          WealthPulse — Built with Next.js · Updated in real-time
        </footer>
      </main>
    </div>
  );
}
