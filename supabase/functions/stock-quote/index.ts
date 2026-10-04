// Returns the latest price for a list of tickers, for the planner's stock grant
// valuation. Runs server-side so the upstream providers' CORS rules don't apply.
//
// Sources, in order: the Yahoo Finance chart API on each of its two hosts (the
// second covers a rate-limited edge), then Nasdaq's public quote API as an
// independent fallback. All keyless — no provider secret to configure.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { getSupabaseClient } from "../_shared/supabase.ts";

const JSON_HEADERS = { ...corsHeaders, "Content-Type": "application/json" };
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

type AssetClass = "stock" | "crypto";

interface Quote {
  symbol: string;
  price: number;
  previousClose?: number;
  source: string;
}

function yahoo(host: string) {
  return async function fromYahoo(symbol: string): Promise<Quote | null> {
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!res.ok) return null;
    const json = await res.json();
    const meta = json?.chart?.result?.[0]?.meta;
    const price = Number(meta?.regularMarketPrice);
    if (!price || !isFinite(price)) return null;
    const prev = Number(meta?.chartPreviousClose ?? meta?.previousClose);
    return {
      symbol,
      price,
      previousClose: isFinite(prev) && prev > 0 ? prev : undefined,
      source: "yahoo",
    };
  };
}

/** "$219.24" / "+5.44" / "" → number or NaN. */
function money(v: unknown): number {
  const s = String(v ?? "").replace(/[$,%\s+]/g, "");
  return s === "" ? NaN : Number(s);
}

/** Nasdaq's public quote API — US listings; `assetclass` must match the instrument. */
function nasdaq(assetclass: "stocks" | "etf") {
  return async function fromNasdaq(symbol: string): Promise<Quote | null> {
    const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/info?assetclass=${assetclass}`;
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!res.ok) return null;
    const json = await res.json();
    const primary = json?.data?.primaryData;
    const price = money(primary?.lastSalePrice);
    if (!price || !isFinite(price)) return null;

    // Day change should read against the *previous day's* close. Outside market hours
    // primaryData is the extended-hours print and secondaryData holds the 4pm close
    // with its change vs. the prior day — back the prior close out of that when present.
    const sec = json?.data?.secondaryData;
    const secPrice = money(sec?.lastSalePrice);
    const secChange = money(sec?.netChange);
    let prev = isFinite(secPrice) && isFinite(secChange) ? secPrice - secChange : NaN;
    if (!isFinite(prev)) {
      const change = money(primary?.netChange);
      prev = isFinite(change) ? price - change : NaN;
    }

    return {
      symbol,
      price,
      previousClose: isFinite(prev) && prev > 0 ? prev : undefined,
      source: "nasdaq",
    };
  };
}

/** Coinbase spot price — keyless, takes plain tickers (BTC, ETH, SOL, DOGE).
 *  The stock providers have no crypto coverage at all, hence a separate family. */
async function coinbase(symbol: string): Promise<Quote | null> {
  const url = `https://api.coinbase.com/v2/prices/${encodeURIComponent(symbol)}-USD/spot`;
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) return null;
  const json = await res.json();
  const price = Number(json?.data?.amount);
  if (!price || !isFinite(price)) return null;
  // Spot has no previous close; nothing in the UI shows a day change for crypto.
  return { symbol, price, source: "coinbase" };
}

// Nasdaq first for equities: it answers server-side clients reliably, while Yahoo
// rate-limits them hard. Yahoo still covers anything Nasdaq doesn't list.
const STOCK_PROVIDERS = [
  nasdaq("stocks"),
  yahoo("query1.finance.yahoo.com"),
  yahoo("query2.finance.yahoo.com"),
  nasdaq("etf"),
];
const CRYPTO_PROVIDERS = [coinbase];

/** Tries the hinted family first, then the other — so a position filed under the
 *  wrong account type still resolves instead of silently showing "no quote". */
async function quoteFor(symbol: string, assetClass: AssetClass): Promise<Quote | null> {
  const providers = assetClass === "crypto"
    ? [...CRYPTO_PROVIDERS, ...STOCK_PROVIDERS]
    : [...STOCK_PROVIDERS, ...CRYPTO_PROVIDERS];
  for (const provider of providers) {
    try {
      const q = await provider(symbol);
      if (q) return q;
    } catch {
      // try the next provider
    }
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = getSupabaseClient(req.headers.get("Authorization")!);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: JSON_HEADERS });
    }

    const body = await req.json().catch(() => ({}));
    const symbols: string[] = Array.isArray(body?.symbols)
      ? body.symbols
      : body?.symbol ? [body.symbol] : [];
    // Hint only — quoteFor falls back to the other provider family either way.
    const assetClass: AssetClass = body?.assetClass === "crypto" ? "crypto" : "stock";

    const clean = [...new Set(
      symbols
        .filter((s): s is string => typeof s === "string")
        .map((s) => s.trim().toUpperCase())
        .filter((s) => /^[A-Z0-9.\-]{1,12}$/.test(s)),
    )].slice(0, 25); // cap the fan-out per request

    if (clean.length === 0) {
      return new Response(JSON.stringify({ error: "No valid symbols provided" }), { status: 400, headers: JSON_HEADERS });
    }

    // Pass assetClass explicitly — a bare `.map(quoteFor)` would hand it the index.
    const settled = await Promise.all(clean.map((s) => quoteFor(s, assetClass)));
    const quotes = settled.filter((q): q is Quote => q !== null);
    const failed = clean.filter((s) => !quotes.some((q) => q.symbol === s));

    return new Response(JSON.stringify({ quotes, failed }), { headers: JSON_HEADERS });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: JSON_HEADERS });
  }
});
