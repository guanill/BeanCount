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

Run the unit tests with `npm test` (Node 22+).
