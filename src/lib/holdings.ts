// Pure valuation helpers for stock holdings (shares × latest quote).

export interface HoldingLike {
  ticker: string;
  shares: number;
}

export interface PriceInfo {
  price: number;
  /** ISO timestamp of when the price was fetched. */
  updatedAt: string;
}

export interface ValuedHolding<T extends HoldingLike> {
  holding: T;
  price: number | null;
  value: number | null;
  stale: boolean;
}

/** A quote older than this is flagged as stale in the UI. */
export const STALE_AFTER_MS = 15 * 60 * 1000;

export function isStale(updatedAt: string, now: number = Date.now()): boolean {
  const t = Date.parse(updatedAt);
  return isNaN(t) || now - t > STALE_AFTER_MS;
}

/** Values each holding; holdings with no known price get `null` price/value. */
export function valueHoldings<T extends HoldingLike>(
  holdings: T[],
  prices: Record<string, PriceInfo>,
  now: number = Date.now()
): ValuedHolding<T>[] {
  return holdings.map((holding) => {
    const p = prices[holding.ticker.trim().toUpperCase()];
    if (!p || !(p.price > 0)) return { holding, price: null, value: null, stale: true };
    return {
      holding,
      price: p.price,
      value: Number(holding.shares) * p.price,
      stale: isStale(p.updatedAt, now),
    };
  });
}

export function totalValue(valued: ValuedHolding<HoldingLike>[]): number {
  return valued.reduce((sum, v) => sum + (v.value ?? 0), 0);
}
