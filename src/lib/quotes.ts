// Live stock quotes for planner grant valuation.
//
// The app is a static export, so quotes are fetched through the `stock-quote`
// Supabase edge function rather than a Next API route — that also keeps the
// upstream provider's CORS rules out of the browser's way.

import { callEdgeFunction } from "@/lib/supabase/functions";

export interface LiveQuote {
  symbol: string;
  price: number;
  previousClose?: number;
  source: string;
}

/** Normalizes a user-typed ticker into the lookup key used everywhere ("nvda " → "NVDA"). */
export function normalizeTicker(t: string): string {
  return t.trim().toUpperCase();
}

/**
 * Fetches the latest price for each symbol. Symbols that can't be resolved are
 * simply absent from the result — callers keep whatever price they already had.
 * Throws only when the whole request fails (offline, function not deployed).
 */
export async function fetchQuotes(symbols: string[]): Promise<Record<string, LiveQuote>> {
  const list = [...new Set(symbols.map(normalizeTicker).filter(Boolean))];
  if (list.length === 0) return {};

  const res = await callEdgeFunction<{ quotes?: LiveQuote[] }>("stock-quote", {
    body: { symbols: list },
  });

  const out: Record<string, LiveQuote> = {};
  for (const q of res.quotes ?? []) {
    if (q && typeof q.price === "number" && q.price > 0) out[normalizeTicker(q.symbol)] = q;
  }
  return out;
}
