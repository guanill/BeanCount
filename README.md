This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Stock holdings tracking

The Overview's **Stock & Investments** card has a **Holdings** panel. Pick any existing account
(e.g. "Robinhood"), then add a ticker and share count. Each position is stored in the
`stock_holdings` table linked to that account (apply `supabase/migrations/20260404000000_stock_holdings.sql`).

- Value = shares × latest quote; per-account and overall totals are shown. Holdings totals are
  informational and are **not** added to account balances or net worth (avoids double counting).
- Quotes refresh on load, every 5 minutes, and via the refresh button. Positions with a quote older
  than 15 minutes show "stale"; tickers with no quote show "no quote", and an unreachable quote
  service keeps the last known prices with a warning.
- Quotes come from the `stock-quote` Supabase edge function (Nasdaq/Yahoo public endpoints, keyless).
  No API key or extra configuration is needed beyond deploying the function:
  `supabase functions deploy stock-quote`.

Each stock position can also store its total cost paid. The Holdings panel shows
market gain/loss from that cost basis, and the live stock valuation feeds the
Overview asset totals and net worth while quotes are available. Apply
`supabase/migrations/20261014000000_stock_cost_basis.sql` before using the field.

Planner salary periods support monthly, twice-monthly, biweekly, and weekly
pay schedules, optional payday numbers, actual paycheck withholding, and optional
year-to-date gross pay and tax-withheld tracking
percentage. The current-month planner card indicates whether the configured
payday has arrived; the percentage is used for take-home projections. Recurring
charges can likewise be auto-marked paid after their configured billing day,
and the planner includes a day-level payment calendar.

The Tax Center estimates Washington tax using federal income tax, Social Security,
Medicare, and WA Cares payroll deductions. Washington has no individual state
income tax, and the Tax Center displays this estimate as a visual breakdown.
When expected withholding is blank, the refund projection uses each applicable
salary schedule's withholding percentage against unpaid future paychecks.
Payroll deductions are estimated from wages; actual pay-stub withholding should
be used for the final refund estimate. If the projection is negative, the
expected tax payment is shown on the planner calendar as an expense rather
than as income.

Transactions can be imported from bank and credit-card CSV exports. The app
tries to identify the destination from the file name or an explicit account/card
number column; including the account/card last four digits in its saved name
helps match exports that include those digits. If the match is missing or
ambiguous, choose the destination manually. Imports recognize common Date,
Description, Amount, Debit, and Credit columns, categorize rows automatically,
and skip rows already imported from that account. Account deletion warns about
linked transactions; transactions remain in history with the former account
name retained. The import panel shows saved CSV transaction counts by month for
the selected account or card, the months represented in the selected file, and
the latest transaction creation time for that source. Coverage updates when the
source selection changes. This time reflects when the latest transaction was
first added; skipped duplicate imports do not refresh it. Apply
`supabase/migrations/20261018000000_transaction_import_fingerprints.sql`
before using CSV imports or deleting accounts/cards with linked transactions.

Run the unit tests with `npm test` (Node 22+).
