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
import { RefreshCw, Bean, LayoutDashboard, Receipt, Sparkles, Landmark, Calculator, LogOut, X, ArrowRight, AlertCircle } from "lucide-react";
import { formatCurrency, daysUntil } from "@/lib/format";
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

  const navItems = [
    { key: "overview", icon: LayoutDashboard, label: "Overview", subtitle: "Accounts, assets, and net worth position" },
    { key: "spending", icon: Receipt, label: "Spending", subtitle: "Transactions, cashflow, and categories" },
    { key: "planner", icon: Sparkles, label: "Planner", subtitle: "Monthly projections, paychecks, and recurring bills" },
    { key: "tax", icon: Calculator, label: "Tax Center", subtitle: "Annual tax estimates, withholding, and refunds" },
    { key: "loans", icon: Landmark, label: "Loans", subtitle: "Amortization schedules and payoff tracking" },
  ] as const;

  const activeNav = navItems.find(n => n.key === view) ?? navItems[0];

  return (
    <div className="min-h-dvh bg-background lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      {/* Desktop Left Sidebar Rail */}
      <aside className="hidden lg:flex lg:flex-col sticky top-0 h-dvh border-r border-border bg-[#0e1017] px-3.5 py-5 justify-between overflow-y-auto overscroll-contain">
        <div className="space-y-6">
          {/* Brand */}
          <div className="flex items-center gap-2.5 px-2.5">
            <div className="w-8 h-8 rounded-lg bg-accent/15 border border-accent/30 flex items-center justify-center shrink-0">
              <Bean className="w-4 h-4 text-accent-light" />
            </div>
            <span className="text-base font-semibold text-foreground tracking-tight">BeanCount</span>
          </div>

          {/* Quiet Net Worth readout */}
          <div className="px-2.5 py-3 rounded-xl bg-card border border-border">
            <div className="text-[11px] font-medium text-foreground/45">Net worth</div>
            <div className={`text-lg font-bold tabular-nums tracking-tight mt-0.5 truncate ${effectiveNetWorth >= 0 ? "text-foreground" : "text-red"}`}>
              {formatCurrency(effectiveNetWorth)}
            </div>
            <div className="mt-2 pt-2 border-t border-border/80 flex items-center justify-between text-[11px] text-foreground/45 tabular-nums">
              <span className="truncate">{formatCurrency(effectiveAssetsTotal)} assets</span>
            </div>
          </div>

          {/* Primary Navigation */}
          <nav aria-label="Primary navigation" className="space-y-0.5">
            {navItems.map(({ key, icon: Icon, label }) => {
              const active = view === key;
              return (
                <button
                  key={key}
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => setView(key)}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                    active
                      ? "bg-accent/15 text-accent-light border border-accent/25"
                      : "border border-transparent text-foreground/55 hover:text-foreground hover:bg-card/70"
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${active ? "text-accent-light" : "text-foreground/40"}`} />
                  <span className="truncate">{label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom utility actions */}
        <div className="space-y-2 pt-4 border-t border-border">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-card hover:bg-card-hover border border-border rounded-lg text-xs font-medium text-foreground/70 hover:text-foreground transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            <span>{refreshing ? "Refreshing…" : "Refresh data"}</span>
          </button>
          <button
            type="button"
            onClick={() => setShowSignOut(true)}
            className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-xs text-foreground/40 hover:text-red hover:bg-red/5 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      {/* Main Content Shell */}
      <div className="min-w-0 flex flex-col">
        {/* Mobile & Tablet Header */}
        <header className="lg:hidden sticky top-0 z-50 backdrop-blur-xl bg-background/90 border-b border-border">
          <div className="px-4 sm:px-6 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-accent/15 border border-accent/30 flex items-center justify-center">
                <Bean className="w-4 h-4 text-accent-light" />
              </div>
              <h1 className="text-base font-semibold text-foreground tracking-tight">BeanCount</h1>
            </div>

            <div className="hidden md:flex items-center gap-1 bg-card border border-border rounded-lg p-1">
              {navItems.map(({ key, icon: Icon, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setView(key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    view === key
                      ? "bg-accent/15 text-accent-light"
                      : "text-foreground/50 hover:text-foreground"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleRefresh}
                disabled={refreshing}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-card hover:bg-card-hover border border-border rounded-lg text-xs text-foreground/70 hover:text-foreground transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
                <span className="hidden sm:inline">Refresh</span>
              </button>
              <button
                type="button"
                onClick={() => setShowSignOut(true)}
                className="p-1.5 bg-card hover:bg-card-hover border border-border rounded-lg text-foreground/45 hover:text-red transition-colors"
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </header>

        {/* Mobile bottom navigation */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 backdrop-blur-xl bg-background/95 border-t border-border" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
          <div className="flex items-center justify-around px-2 py-2">
            {navItems.map(({ key, icon: Icon, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setView(key)}
                className={`flex flex-col items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                  view === key
                    ? "text-accent-light"
                    : "text-foreground/40 hover:text-foreground/65"
                }`}
              >
                <Icon className="w-4 h-4" />
                {label === "Tax Center" ? "Tax" : label}
              </button>
            ))}
          </div>
        </nav>

        <main className="w-full max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8 pb-24 md:pb-12 space-y-7">
          {view === "overview" && (() => {
            const urgentCards = data.creditCards.filter((card) => {
              const d = daysUntil(card.due_date);
              return card.balance_owed > 0 && d !== null && d <= 10;
            });
            const monthlyLoanTotal = data.loans.reduce((s, l) => s + Number(l.monthly_payment || 0), 0);

            return (
              <>
                {/* Overview Header + Quick Workflow Jumps */}
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <h1 className="text-2xl font-bold text-foreground tracking-tight">Overview</h1>
                    <p className="text-sm text-foreground/45 mt-0.5">{activeNav.subtitle}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setView("spending")}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card hover:bg-card-hover border border-border text-xs font-medium text-foreground/75 hover:text-foreground transition-colors"
                    >
                      <Receipt className="w-3.5 h-3.5 text-accent-light" />
                      Review transactions
                      <ArrowRight className="w-3 h-3 text-foreground/40" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setView("planner")}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card hover:bg-card-hover border border-border text-xs font-medium text-foreground/75 hover:text-foreground transition-colors"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-accent-light" />
                      Monthly plan
                      <ArrowRight className="w-3 h-3 text-foreground/40" />
                    </button>
                    {data.loans.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setView("loans")}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card hover:bg-card-hover border border-border text-xs font-medium text-foreground/75 hover:text-foreground transition-colors tabular-nums"
                      >
                        <Landmark className="w-3.5 h-3.5 text-accent-light" />
                        {data.loans.length} loan{data.loans.length === 1 ? "" : "s"} · {formatCurrency(monthlyLoanTotal)}/mo
                        <ArrowRight className="w-3 h-3 text-foreground/40" />
                      </button>
                    )}
                  </div>
                </div>

                {data.accounts.bank.length + data.accounts.cash.length + data.accounts.stock.length + data.accounts.crypto.length === 0 && (
                  <section className="surface-card p-5 sm:p-6">
                    <p className="text-xs font-semibold uppercase tracking-wider text-accent-light mb-1">Welcome to BeanCount</p>
                    <h2 className="text-lg font-semibold text-foreground">Start with your first account</h2>
                    <p className="text-sm text-foreground/55 mt-1 max-w-xl">Add an account manually or connect your bank so your assets, spending, and net worth have a reliable starting point.</p>
                    <button onClick={() => document.getElementById("accounts-section")?.scrollIntoView({ behavior: "smooth" })} className="mt-4 px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-light transition-colors">
                      Add an account
                    </button>
                  </section>
                )}

                {/* Row 1: 4 Decision-Ready KPIs */}
                <NetWorthHero
                  netWorth={effectiveNetWorth}
                  liquidTotal={data.totals.bankTotal + data.totals.cashTotal}
                  investmentsTotal={effectiveStockTotal + effectiveCryptoTotal}
                  creditCardDebt={data.totals.creditCardDebt}
                  liabilitiesTotal={data.totals.liabilitiesTotal}
                  debtsOwedTotal={data.totals.debtsOwedTotal}
                  pointsValue={data.totals.pointsValue}
                />

                {/* Attention banner if any credit card payment is due soon */}
                {urgentCards.length > 0 && (
                  <div className="surface-card px-4 py-3 flex flex-wrap items-center justify-between gap-3 border-yellow/30 bg-yellow/5">
                    <div className="flex items-center gap-2.5 text-xs text-foreground/85">
                      <AlertCircle className="w-4 h-4 text-yellow shrink-0" />
                      <span>
                        <strong className="font-semibold text-foreground">Upcoming card payment{urgentCards.length > 1 ? "s" : ""}:</strong>{" "}
                        {urgentCards.map((c) => {
                          const d = daysUntil(c.due_date);
                          return `${c.name} (${formatCurrency(c.balance_owed)} · ${d !== null && d < 0 ? `${Math.abs(d)}d overdue` : d === 0 ? "due today" : `in ${d}d`})`;
                        }).join(" · ")}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => document.getElementById("cards-obligations-section")?.scrollIntoView({ behavior: "smooth" })}
                      className="text-xs font-medium text-yellow hover:underline shrink-0"
                    >
                      View cards ↓
                    </button>
                  </div>
                )}

                {/* Row 2: Trajectory & Allocation (7 / 5 split) */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
                  <div className="lg:col-span-7">
                    <NetWorthHistory snapshots={netWorthHistory} />
                  </div>
                  <div className="lg:col-span-5">
                    <AssetBreakdown
                      bankTotal={data.totals.bankTotal}
                      stockTotal={effectiveStockTotal}
                      cryptoTotal={effectiveCryptoTotal}
                      cashTotal={data.totals.cashTotal}
                      assetsTotal={effectiveAssetsTotal}
                    />
                  </div>
                </div>

                {/* Section: Cash & Investments */}
                <section id="accounts-section" className="space-y-3">
                  <div className="flex items-baseline justify-between px-0.5">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground/45">Cash & Investment Accounts</h2>
                    <span className="text-xs text-foreground/45 tabular-nums">{formatCurrency(effectiveAssetsTotal)} total</span>
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
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
                </section>

                {/* Section: Cards, Receivables & Payables */}
                <section id="cards-obligations-section" className="space-y-3">
                  <div className="flex items-baseline justify-between px-0.5">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground/45">Cards, Receivables & Payables</h2>
                    <span className="text-xs text-foreground/45 tabular-nums">
                      −{formatCurrency(data.totals.creditCardDebt + data.totals.liabilitiesTotal)} owed · +{formatCurrency(data.totals.debtsOwedTotal)} receivable
                    </span>
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
                    <CreditCardsSection
                      cards={data.creditCards}
                      totalDebt={data.totals.creditCardDebt}
                      totalPointsValue={data.totals.pointsValue}
                      onRefresh={handleRefresh}
                    />
                    <div className="space-y-5">
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
                  </div>
                </section>

                {/* Row 5: Net Worth Ledger */}
                <FinalTotals
                  assetsTotal={effectiveAssetsTotal}
                  debtsOwedTotal={data.totals.debtsOwedTotal}
                  pointsValue={data.totals.pointsValue}
                  creditCardDebt={data.totals.creditCardDebt}
                  liabilitiesTotal={data.totals.liabilitiesTotal}
                  netWorth={effectiveNetWorth}
                />
              </>
            );
          })()}

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

          <footer className="lg:hidden text-center py-6 text-foreground/25 text-xs">
            BeanCount · Every bean, accounted for.
          </footer>
        </main>
      </div>

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
