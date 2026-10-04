"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Account, StockHolding } from "@/lib/types";
import { formatCurrency } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import {
  getStockHoldings,
  createStockHolding,
  updateStockHolding,
  deleteStockHolding,
} from "@/lib/supabase/queries";
import { fetchQuotes, normalizeTicker } from "@/lib/quotes";
import { valueHoldings, totalValue, PriceInfo } from "@/lib/holdings";
import { Pencil, Trash2, Plus, RefreshCw, AlertTriangle } from "lucide-react";
import { useToast } from "./Toast";

const REFRESH_MS = 5 * 60 * 1000;

interface Props {
  /** Every account the user owns — holdings can be attached to any of them. */
  accounts: Account[];
}

export default function StockHoldings({ accounts }: Props) {
  const { toast } = useToast();
  const [holdings, setHoldings] = useState<StockHolding[]>([]);
  const [prices, setPrices] = useState<Record<string, PriceInfo>>({});
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ account_id: "", ticker: "", shares: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ ticker: "", shares: "" });

  const tickerKey = useMemo(
    () => [...new Set(holdings.map((h) => normalizeTicker(h.ticker)))].sort().join(","),
    [holdings]
  );

  const load = useCallback(async () => {
    try {
      setHoldings(await getStockHoldings(createClient()));
    } catch (e) {
      console.error("Failed to load holdings:", e);
      setQuoteError("Couldn't load holdings (has the stock_holdings migration been applied?)");
    } finally {
      setLoaded(true);
    }
  }, []);

  const refreshQuotes = useCallback(async () => {
    if (!tickerKey) return;
    setRefreshing(true);
    try {
      const quotes = await fetchQuotes(tickerKey.split(","));
      const now = new Date().toISOString();
      setPrices((prev) => {
        const next = { ...prev };
        for (const [sym, q] of Object.entries(quotes)) next[sym] = { price: q.price, updatedAt: now };
        return next;
      });
      const missing = tickerKey.split(",").filter((s) => !quotes[s]);
      setQuoteError(missing.length ? `No quote found for ${missing.join(", ")}` : null);
      if (Object.keys(quotes).length) setLastRefresh(now);
    } catch (e) {
      setQuoteError("Quote service unavailable — showing last known prices");
      console.error("Quote refresh failed:", e);
    } finally {
      setRefreshing(false);
    }
  }, [tickerKey]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    refreshQuotes();
    const id = setInterval(refreshQuotes, REFRESH_MS);
    return () => clearInterval(id);
  }, [refreshQuotes]);

  const valued = valueHoldings(holdings, prices);
  const total = totalValue(valued);

  const byAccount = accounts
    .map((a) => ({ account: a, items: valued.filter((v) => v.holding.account_id === a.id) }))
    .filter((g) => g.items.length > 0);

  async function run(action: () => Promise<void>, ok: string) {
    try {
      await action();
      toast(ok);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast(msg.includes("duplicate") ? "That ticker is already in this account" : "Failed: " + msg, "error");
    }
  }

  function parseShares(v: string): number | null {
    const n = parseFloat(v);
    return isFinite(n) && n > 0 ? n : null;
  }

  async function saveNew() {
    const ticker = normalizeTicker(form.ticker);
    const shares = parseShares(form.shares);
    if (!form.account_id || !/^[A-Z0-9.\-]{1,12}$/.test(ticker) || shares === null) {
      toast("Choose an account, a valid ticker and a share count above 0", "error");
      return;
    }
    await run(async () => {
      await createStockHolding(createClient(), { account_id: form.account_id, ticker, shares });
      setForm({ account_id: form.account_id, ticker: "", shares: "" });
      setAdding(false);
    }, "Holding added");
  }

  async function saveEdit(id: string) {
    const ticker = normalizeTicker(editForm.ticker);
    const shares = parseShares(editForm.shares);
    if (!/^[A-Z0-9.\-]{1,12}$/.test(ticker) || shares === null) {
      toast("Enter a valid ticker and a share count above 0", "error");
      return;
    }
    await run(async () => {
      await updateStockHolding(createClient(), id, { ticker, shares });
      setEditingId(null);
    }, "Holding updated");
  }

  async function remove(id: string) {
    if (!confirm("Remove this holding?")) return;
    await run(() => deleteStockHolding(createClient(), id), "Holding removed");
  }

  const input = "min-w-0 bg-background border border-border rounded-lg px-2 py-1 text-sm text-foreground focus:outline-none focus:border-accent";

  return (
    <div className="mt-4 pt-4 border-t border-border/40">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div>
          <h3 className="text-sm font-bold text-foreground">Holdings</h3>
          <p className="text-[10px] sm:text-xs text-foreground/50">
            {holdings.length === 0 ? "No positions yet" : `Total ${formatCurrency(total)}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={refreshQuotes}
            disabled={refreshing || !tickerKey}
            title="Refresh quotes"
            className="flex items-center gap-1 text-[10px] sm:text-xs text-foreground/50 hover:text-accent disabled:opacity-40"
          >
            <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Updating…" : lastRefresh ? `Live · ${new Date(lastRefresh).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Refresh"}
          </button>
          <button
            type="button"
            onClick={() => setAdding(!adding)}
            disabled={accounts.length === 0}
            title={accounts.length === 0 ? "Create an account first" : undefined}
            className="text-[10px] sm:text-xs text-accent-light hover:text-accent flex items-center gap-1 disabled:opacity-40"
          >
            <Plus className="w-3 h-3" /> Add
          </button>
        </div>
      </div>

      {quoteError && (
        <p className="mb-2 flex items-center gap-1 text-xs text-yellow-400/90">
          <AlertTriangle className="w-3 h-3 shrink-0" /> {quoteError}
        </p>
      )}

      {adding && (
        <div className="mb-2 p-3 rounded-xl bg-card border border-border/60 space-y-2">
          <select
            value={form.account_id}
            onChange={(e) => setForm({ ...form, account_id: e.target.value })}
            className={`w-full ${input}`}
          >
            <option value="">Select account…</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Ticker"
              value={form.ticker}
              onChange={(e) => setForm({ ...form, ticker: e.target.value })}
              className={`flex-1 uppercase ${input}`}
            />
            <input
              type="number"
              step="any"
              min="0"
              placeholder="Shares"
              value={form.shares}
              onChange={(e) => setForm({ ...form, shares: e.target.value })}
              className={`flex-1 ${input}`}
            />
            <button type="button" onClick={saveNew} className="px-3 py-1.5 bg-accent text-white rounded-lg text-xs hover:bg-accent-light">Save</button>
            <button type="button" onClick={() => setAdding(false)} className="px-2 py-1.5 text-foreground/50 hover:text-foreground text-xs">Cancel</button>
          </div>
        </div>
      )}

      {!loaded && <p className="text-xs text-foreground/30 py-2">Loading…</p>}

      <div className="space-y-3">
        {byAccount.map(({ account, items }) => (
          <div key={account.id}>
            <p className="text-xs font-medium text-foreground/60 mb-1">
              {account.name} · {formatCurrency(totalValue(items))}
            </p>
            <div className="space-y-1">
              {items.map(({ holding: h, price, value, stale }) => (
                <div key={h.id} className="group p-2 rounded-lg bg-card/60 hover:bg-card-hover">
                  {editingId === h.id ? (
                    <div className="flex items-center gap-2">
                      <input value={editForm.ticker} onChange={(e) => setEditForm({ ...editForm, ticker: e.target.value })} className={`w-20 uppercase ${input}`} />
                      <input type="number" step="any" min="0" value={editForm.shares} onChange={(e) => setEditForm({ ...editForm, shares: e.target.value })} className={`flex-1 ${input}`} />
                      <button type="button" onClick={() => saveEdit(h.id)} className="px-2 py-1 bg-accent text-white rounded-lg text-xs">Save</button>
                      <button type="button" onClick={() => setEditingId(null)} className="text-foreground/50 text-xs">Cancel</button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">{h.ticker}</p>
                        <p className="text-xs text-foreground/50">
                          {h.shares} sh ×{" "}
                          {price === null ? "no quote" : formatCurrency(price)}
                          {price !== null && stale && <span className="ml-1 text-yellow-400/80">· stale</span>}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-sm font-bold text-foreground">{value === null ? "—" : formatCurrency(value)}</span>
                        <div className="hidden group-hover:flex items-center gap-1">
                          <button onClick={() => { setEditingId(h.id); setEditForm({ ticker: h.ticker, shares: String(h.shares) }); }} className="p-1 text-foreground/30 hover:text-accent" title="Edit">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => remove(h.id)} className="p-1 text-foreground/30 hover:text-red" title="Remove">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
