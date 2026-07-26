// Federal + FICA + WA payroll tax math shared by the planner projection and the
// tax estimator. Tables are keyed by tax year so annual IRS inflation adjustments
// are a one-place update; lookups fall back to the closest earlier year.

export type FilingStatus = "single" | "mfj" | "mfs" | "hoh";

/** [bracket floor, bracket ceiling, rate] — ceiling Infinity for the top bracket. */
type Bracket = [number, number, number];

interface TaxYearTable {
  brackets: Record<FilingStatus, Bracket[]>;
  standardDeduction: Record<FilingStatus, number>;
  ssWageBase: number;
  /** Additional 0.9% Medicare tax kicks in above this (statutory, not indexed). */
  medicareAddlThreshold: Record<FilingStatus, number>;
  /** WA Cares Fund (long-term care) premium rate on wages. */
  waCaresRate: number;
}

const SS_RATE            = 0.062;
const MEDICARE_RATE      = 0.0145;
const MEDICARE_ADDL_RATE = 0.009;

const MEDICARE_ADDL_THRESHOLD: Record<FilingStatus, number> = {
  single: 200000, mfj: 250000, mfs: 125000, hoh: 200000,
};

export const TAX_TABLES: Record<number, TaxYearTable> = {
  // 2025 — brackets per Rev. Proc. 2024-40; standard deduction per OBBBA (July 2025).
  2025: {
    brackets: {
      single: [[0,11925,.10],[11925,48475,.12],[48475,103350,.22],[103350,197300,.24],[197300,250525,.32],[250525,626350,.35],[626350,Infinity,.37]],
      mfj:    [[0,23850,.10],[23850,96950,.12],[96950,206700,.22],[206700,394600,.24],[394600,501050,.32],[501050,751600,.35],[751600,Infinity,.37]],
      mfs:    [[0,11925,.10],[11925,48475,.12],[48475,103350,.22],[103350,197300,.24],[197300,250525,.32],[250525,375800,.35],[375800,Infinity,.37]],
      hoh:    [[0,17000,.10],[17000,64850,.12],[64850,103350,.22],[103350,197300,.24],[197300,250500,.32],[250500,626350,.35],[626350,Infinity,.37]],
    },
    standardDeduction: { single: 15750, mfj: 31500, mfs: 15750, hoh: 23625 },
    ssWageBase: 176100,
    medicareAddlThreshold: MEDICARE_ADDL_THRESHOLD,
    waCaresRate: 0.0058,
  },
  // 2026 — per Rev. Proc. 2025-32 inflation adjustments (verify against final IRS figures).
  2026: {
    brackets: {
      single: [[0,12400,.10],[12400,50400,.12],[50400,105700,.22],[105700,201775,.24],[201775,256225,.32],[256225,640600,.35],[640600,Infinity,.37]],
      mfj:    [[0,24800,.10],[24800,100800,.12],[100800,211400,.22],[211400,403550,.24],[403550,512450,.32],[512450,768700,.35],[768700,Infinity,.37]],
      mfs:    [[0,12400,.10],[12400,50400,.12],[50400,105700,.22],[105700,201775,.24],[201775,256225,.32],[256225,384350,.35],[384350,Infinity,.37]],
      hoh:    [[0,17700,.10],[17700,67450,.12],[67450,105700,.22],[105700,201775,.24],[201775,256200,.32],[256200,640600,.35],[640600,Infinity,.37]],
    },
    standardDeduction: { single: 16100, mfj: 32200, mfs: 16100, hoh: 24150 },
    ssWageBase: 184500,
    medicareAddlThreshold: MEDICARE_ADDL_THRESHOLD,
    waCaresRate: 0.0058,
  },
};

/** Table for the given year — closest earlier year if missing, earliest table as last resort. */
export function taxTableFor(year: number): TaxYearTable {
  if (TAX_TABLES[year]) return TAX_TABLES[year];
  const years = Object.keys(TAX_TABLES).map(Number).sort((a, b) => a - b);
  const prior = [...years].reverse().find(y => y <= year);
  return TAX_TABLES[prior ?? years[0]];
}

export interface FederalBracketDetail {
  rate: number;
  from: number;
  to: number | null; // null = top bracket
  taxed: number;
  tax: number;
}

export interface AnnualTaxBreakdown {
  taxable: number;
  federal: number;
  federalBrackets: FederalBracketDetail[];
  ss: number;
  medicare: number;
  waCares: number;
  total: number;
  marginal: number;
  effectiveRate: number;
  net: number;
}

/** Full annual tax breakdown for a gross income, or null when there's no income. */
export function computeAnnualTax(annualGross: number, status: FilingStatus, year: number = new Date().getFullYear()): AnnualTaxBreakdown | null {
  if (!annualGross || annualGross <= 0) return null;
  const t = taxTableFor(year);
  const taxable = Math.max(0, annualGross - t.standardDeduction[status]);

  let federal = 0;
  const federalBrackets: FederalBracketDetail[] = [];
  for (const [min, max, rate] of t.brackets[status]) {
    if (taxable <= min) break;
    const taxed = Math.min(taxable, max) - min;
    const tax   = taxed * rate;
    federal += tax;
    federalBrackets.push({ rate, from: min, to: max === Infinity ? null : max, taxed, tax });
  }

  const ss       = Math.min(annualGross, t.ssWageBase) * SS_RATE;
  const medicare = annualGross * MEDICARE_RATE + Math.max(0, annualGross - t.medicareAddlThreshold[status]) * MEDICARE_ADDL_RATE;
  const waCares  = annualGross * t.waCaresRate;
  const total    = federal + ss + medicare + waCares;
  const marginal = [...t.brackets[status]].reverse().find(([min]) => taxable > min)?.[2] ?? 0.10;

  return {
    taxable, federal, federalBrackets, ss, medicare, waCares, total, marginal,
    effectiveRate: total / annualGross,
    net: annualGross - total,
  };
}

/** Monthly after-tax take-home for an annual gross salary. */
export function computeMonthlyNet(annualSalary: number, status: FilingStatus, year?: number): number {
  const b = computeAnnualTax(annualSalary, status, year);
  return b ? b.net / 12 : 0;
}

/**
 * Flat withholding applied to supplemental income (bonuses, RSU vests):
 * 22% federal supplemental rate + 6.2% SS + 1.45% Medicare + 0.58% WA Cares.
 * An approximation — SS phases out above the wage base and the true liability
 * settles at the marginal rate, but this is what actually lands in the account.
 */
export const SUPPLEMENTAL_TAX_RATE = 0.22 + SS_RATE + MEDICARE_RATE + 0.0058;

/** Estimated cash that lands from a gross bonus/vest after supplemental withholding. */
export function netOfSupplemental(gross: number): number {
  return gross > 0 ? gross * (1 - SUPPLEMENTAL_TAX_RATE) : gross;
}
