"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { DashboardData, NetWorthSnapshot } from "@/lib/types";
import NetWorthHero from "./NetWorthHero";
import AccountSection from "./AccountSection";
import StockHoldings from "./StockHoldings";
import CreditCardsSection from "./CreditCardsSection";
import DebtsSection from "./DebtsSection";
import AssetBreakdown from "./AssetBreakdown";
import FinalTotals from "./FinalTotals";
import LiabilitiesSection from "./LiabilitiesSection";
import NetWorthHistory from "./NetWorthHistory";
import TabErrorBoundary from "./TabErrorBoundary";
import { RefreshCw, Bean, LayoutDashboard, Receipt, Sparkles, Landmark, Calculator, LogOut, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getDashboardData, getNetWorthHistory, saveNetWorthSnapshot } from "@/lib/supabase/queries";

const TabLoader = () => (
  <div className="py-16 flex items-center justify-center text-sm text-foreground/50">
    Loading...
  </div>
);

const TransactionsSection = dynamic(() => import("./TransactionsSection"), { loading: TabLoader });
const PlannerSection = dynamic(() => import("./PlannerSection"), { loading: TabLoader });
const TaxCenter = dynamic(() => import("./TaxCenter"), { loading: TabLoader });
const LoansSection = dynamic(() => import("./LoansSection"), { loading: TabLoader });

type View = "overview" | "spending" | "planner" | "tax" | "loans";
const VIEWS: View[] = ["overview", "spending", "planner", "tax", "loans"];

/** Read the active tab from the URL hash so a refresh keeps you where you were. */
function readViewFromHash(): View {
  if (typeof window === "undefined") return "overview";
  const hash = window.location.hash.replace(/^#/, "") as View;
  return VIEWS.includes(hash) ? hash : "overview";
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<View>(readViewFromHash);
  const [showSignOut, setShowSignOut] = useState(false);
  const [stockHoldingsValue, setStockHoldingsValue] = useState<number | null>(null);
  const [cryptoHoldingsValue, setCryptoHoldingsValue] = useState<number | null>(null);
  const [netWorthHistory, setNetWorthHistory] = useState<NetWorthSnapshot[]>([]);
  const [spendingMounted, setSpendingMounted] = useState(() => readViewFromHash() === "spending");
  const lastSavedSnapshotKey = useRef<string | null>(null);

  useEffect(() => {
    if (view === "spending") setSpendingMounted(true);
  }, [view]);

  // Sync view → URL hash, and respond to back/forward navigation.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash.replace(/^#/, "") !== view) {
      const url = `${window.location.pathname}${window.location.search}#${view}`;
      window.history.replaceState(null, "", url);
    }
  }, [view]);

  useEffect(() => {
    const onHashChange = () => setView(readViewFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const supabase = createClient();
      const dashboardData = await getDashboardData(supabase);
      setData(dashboardData);
      try {
        await saveNetWorthSnapshot(supabase, {
          net_worth: dashboardData.totals.netWorth,
          assets_total: dashboardData.totals.assetsTotal,
          stock_total: dashboardData.totals.stockTotal,
          crypto_total: dashboardData.totals.cryptoTotal,
        });
        setNetWorthHistory(await getNetWorthHistory(supabase));
      } catch (historyError) {
        console.error("Failed to update net worth history:", historyError);
      }
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

  // Realtime: auto-refresh when any overview table changes (debounced to avoid refetch storms)
  useEffect(() => {
    const supabase = createClient();
    const tables = [
      "accounts",
      "credit_cards",
      "debts_owed",
      "liabilities",
      "loans",
      "stock_holdings",
      "planner_configs",
    ];
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fetchData();
      }, 500);
    };
    const channel = supabase.channel("dashboard-realtime");
    for (const table of tables) {
      channel.on("postgres_changes" as any, { event: "*", schema: "public", table }, scheduleRefresh);
    }
    channel.subscribe((status, err) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.error("Dashboard realtime channel error:", err ?? status);
      }
    });
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [fetchData]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const effectiveStockTotal = stockHoldingsValue !== null && stockHoldingsValue > 0
    ? stockHoldingsValue
    : data?.totals.stockTotal ?? 0;
  const effectiveCryptoTotal = cryptoHoldingsValue !== null && cryptoHoldingsValue > 0
    ? cryptoHoldingsValue
    : data?.totals.cryptoTotal ?? 0;
  const effectiveAssetsTotal = data
    ? data.totals.assetsTotal - data.totals.stockTotal - data.totals.cryptoTotal + effectiveStockTotal + effectiveCryptoTotal
    : 0;
  const effectiveNetWorth = data
    ? data.totals.netWorth - data.totals.stockTotal - data.totals.cryptoTotal + effectiveStockTotal + effectiveCryptoTotal
    : 0;

  // Keep today's net worth snapshot synced when live stock/crypto quotes arrive.
  useEffect(() => {
    if (!data) return;
    if (stockHoldingsValue === null && cryptoHoldingsValue === null) return;
    const key = [
      effectiveNetWorth.toFixed(2),
      effectiveAssetsTotal.toFixed(2),
      effectiveStockTotal.toFixed(2),
      effectiveCryptoTotal.toFixed(2),
    ].join("|");
    if (lastSavedSnapshotKey.current === key) return;
    const timer = setTimeout(async () => {
      try {
        const supabase = createClient();
        await saveNetWorthSnapshot(supabase, {
          net_worth: effectiveNetWorth,
          assets_total: effectiveAssetsTotal,
          stock_total: effectiveStockTotal,
          crypto_total: effectiveCryptoTotal,
        });
        lastSavedSnapshotKey.current = key;
        setNetWorthHistory(await getNetWorthHistory(supabase));
      } catch (historyError) {
        console.error("Failed to sync live net worth snapshot:", historyError);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [data, stockHoldingsValue, cryptoHoldingsValue, effectiveNetWorth, effectiveAssetsTotal, effectiveStockTotal, effectiveCryptoTotal]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <span className="text-4xl animate-bounce">🫘</span>
          <p className="text-foreground/50 text-sm">Counting your beans...</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-red text-lg">Oops — couldn&apos;t load your beans</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-background/80 border-b border-border/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-accent rounded-xl glow-pulse">
              <Bean className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-bold text-foreground tracking-tight">BeanCount</h1>
              <p className="text-xs text-foreground/40 hidden sm:block">Personal Finance Dashboard</p>
            </div>
          </div>

          {/* Desktop tab switcher */}
          <div className="hidden md:flex items-center gap-1 bg-card border border-border/50 rounded-xl p-1">
            {([
              { key: "overview", icon: LayoutDashboard, label: "Overview" },
              { key: "spending", icon: Receipt, label: "Spending" },
              { key: "planner", icon: Sparkles, label: "Planner" },
              { key: "tax", icon: Calculator, label: "Tax" },
              { key: "loans", icon: Landmark, label: "Loans" },
            ] as const).map(({ key, icon: Icon, label }) => (
              <button
                key={key}
                onClick={() => setView(key)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  view === key
                    ? "bg-accent text-white shadow-sm"
                    : "text-foreground/50 hover:text-foreground"
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-card hover:bg-card-hover border border-border/50 rounded-xl text-sm text-foreground/70 hover:text-foreground transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <button
              onClick={() => setShowSignOut(true)}
              className="flex items-center gap-2 px-3 py-2 bg-card hover:bg-card-hover border border-border/50 rounded-xl text-sm text-foreground/40 hover:text-red transition-all"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile bottom navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 backdrop-blur-xl bg-background/90 border-t border-border/50" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        <div className="flex items-center justify-around px-2 py-2.5">
          {([
            { key: "overview", icon: LayoutDashboard, label: "Overview" },
            { key: "spending", icon: Receipt, label: "Spending" },
            { key: "planner", icon: Sparkles, label: "Planner" },
            { key: "tax", icon: Calculator, label: "Tax" },
            { key: "loans", icon: Landmark, label: "Loans" },
          ] as const).map(({ key, icon: Icon, label }) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className={`flex flex-col items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                view === key
                  ? "text-accent"
                  : "text-foreground/40 hover:text-foreground/60"
              }`}
            >
              <Icon className="w-5 h-5" />
              {label}
            </button>
          ))}
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-24 md:pb-8 space-y-6 sm:space-y-8">
        {view === "overview" && (
          <>
            {data.accounts.bank.length + data.accounts.cash.length + data.accounts.stock.length + data.accounts.crypto.length === 0 && (
              <section className="rounded-2xl border border-accent/30 bg-accent/10 p-5 sm:p-6">
                <p className="text-xs font-semibold uppercase tracking-wider text-accent-light mb-1">Welcome to BeanCount</p>
                <h2 className="text-xl font-bold text-foreground">Start with your first account</h2>
                <p className="text-sm text-foreground/60 mt-1 max-w-xl">Add an account manually or connect your bank so your assets, spending, and net worth have a reliable starting point.</p>
                <button onClick={() => document.getElementById("accounts-section")?.scrollIntoView({ behavior: "smooth" })} className="mt-4 px-4 py-2 rounded-xl bg-accent text-white text-sm font-semibold hover:bg-accent-light transition-colors">
                  Add an account
                </button>
              </section>
            )}
            {/* Hero - Net Worth */}
            <NetWorthHero
              netWorth={effectiveNetWorth}
              assetsTotal={effectiveAssetsTotal}
              creditCardDebt={data.totals.creditCardDebt}
              liabilitiesTotal={data.totals.liabilitiesTotal}
            />
            <NetWorthHistory snapshots={netWorthHistory} />

            {/* Asset Breakdown + Accounts Grid */}
            <div id="accounts-section" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <AccountSection
                type="bank"
                accounts={data.accounts.bank}
                total={data.totals.bankTotal}
                onRefresh={handleRefresh}
              />
              <AccountSection
                type="cash"
                accounts={data.accounts.cash}
                total={data.totals.cashTotal}
                onRefresh={handleRefresh}
              />
              {/* Each panel is scoped to its own accounts: that keeps the two from
                  rendering each other's positions, and means the parent account's
                  type reliably picks the right quote provider. */}
              <AccountSection
                type="stock"
                accounts={data.accounts.stock}
                total={effectiveStockTotal}
                onRefresh={handleRefresh}
                automaticHoldings
              >
                <StockHoldings accounts={data.accounts.stock} assetClass="stock" onValuationChange={setStockHoldingsValue} />
              </AccountSection>
              <AccountSection
                type="crypto"
                accounts={data.accounts.crypto}
                total={effectiveCryptoTotal}
                onRefresh={handleRefresh}
                automaticHoldings
              >
                <StockHoldings accounts={data.accounts.crypto} assetClass="crypto" onValuationChange={setCryptoHoldingsValue} />
              </AccountSection>
            </div>

            {/* Asset Breakdown Donut */}
            <AssetBreakdown
              bankTotal={data.totals.bankTotal}
              stockTotal={effectiveStockTotal}
              cryptoTotal={effectiveCryptoTotal}
              cashTotal={data.totals.cashTotal}
              assetsTotal={effectiveAssetsTotal}
            />

            {/* Credit Cards + Debts + Liabilities */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
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
              <LiabilitiesSection
                liabilities={data.liabilities}
                total={data.totals.liabilitiesTotal}
                onRefresh={handleRefresh}
              />
            </div>

            {/* Final Summary */}
            <FinalTotals
              assetsTotal={effectiveAssetsTotal}
              debtsOwedTotal={data.totals.debtsOwedTotal}
              pointsValue={data.totals.pointsValue}
              creditCardDebt={data.totals.creditCardDebt}
              liabilitiesTotal={data.totals.liabilitiesTotal}
              netWorth={effectiveNetWorth}
            />
          </>
        )}

        {/* Lazy-load TransactionsSection on first visit, then keep mounted to preserve filter state */}
        {spendingMounted && (
          <div className={view === "spending" ? "" : "hidden"}>
            <TabErrorBoundary name="Spending">
              <TransactionsSection />
            </TabErrorBoundary>
          </div>
        )}

        {view === "loans" && (
          <TabErrorBoundary name="Loans">
            <LoansSection />
          </TabErrorBoundary>
        )}
        {view === "planner" && (
          <TabErrorBoundary name="Planner">
            <PlannerSection netWorth={effectiveNetWorth} stockTotal={effectiveStockTotal} loans={data.loans} />
          </TabErrorBoundary>
        )}
        {view === "tax" && (
          <TabErrorBoundary name="Tax Center">
            <TaxCenter />
          </TabErrorBoundary>
        )}

        {/* Footer */}
        <footer className="text-center py-6 text-foreground/20 text-xs">
          BeanCount · Every bean, accounted for.
        </footer>
      </main>

      {/* Sign-out confirmation modal */}
      {showSignOut && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowSignOut(false)}>
          <div className="bg-card border border-border/50 rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-foreground">Sign Out</h3>
              <button onClick={() => setShowSignOut(false)} className="p-1 rounded-lg hover:bg-background/60 text-foreground/40 hover:text-foreground transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm text-foreground/60 mb-6">Are you sure you want to sign out of BeanCount?</p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowSignOut(false)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-border/50 text-sm font-medium text-foreground/70 hover:bg-background/60 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const supabase = createClient();
                  await supabase.auth.signOut();
                  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
                  window.location.href = `${basePath}/login`;
                }}
                className="flex-1 px-4 py-2.5 rounded-xl bg-red/20 border border-red/30 text-sm font-medium text-red hover:bg-red/30 transition-colors"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
