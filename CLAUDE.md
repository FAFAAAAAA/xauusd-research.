# CLAUDE.md

XAUUSD research website (Next.js 14 App Router + TypeScript + PostgreSQL/Supabase, deployed on Vercel).
Historical replay, strategy backtests, TradingView webhook, Telegram alerts, trade journal, risk calculator,
plus Pine Script indicators and an MT5 EA. `README.md` (Indonesian) is the full spec and change log.

## Commands

```bash
npm install                 # no lockfile is committed; don't add package-lock.json
npm run dev                 # http://localhost:3000
npm test                    # unit tests (node:test via tsx), no DB needed — run before every commit
npm run typecheck           # tsc --noEmit — run before every commit
npm run build               # next build — run when pages/routes/config change
npm run test:e2e            # needs local Postgres + psql; env PGHOST (default /var/tmp), PGPORT (54329), PGUSER (postgres); creates db xau_e2e
npm run db:migrate          # applies only the init migration to $DATABASE_URL
node scripts/pack-market-data.mjs <csv-dir>   # pack forexsb CSVs into data/market/*.bin.gz + manifest.json
```

- Run a single test file: `npx tsx --test tests/snr.test.ts`.
- New unit test files must be added to the `test` script in `package.json` (files are listed explicitly).
- `npm run build`/`typecheck` rewrite `tsconfig.tsbuildinfo` and `next-env.d.ts` — revert them (`git checkout -- tsconfig.tsbuildinfo next-env.d.ts`) unless the change is intended.
- Env vars: see `.env.example`. `REQUIRE_LOGIN` is off by default (owner's choice).

## Layout

- `src/lib/core/` — framework-free pure logic (time, CSV, timeframes, tradesim, metrics, risk stats, broker costs, instruments). Unit-tested.
- `src/lib/core/strategy/` — strategy adapters (`StrategyAdapter.evaluate(ctx)`), `registry.ts` (REGISTRY), `methods-meta.ts` (METHODS: adapterKey/version/label).
- `src/lib/server/` — DB, services (backtest, replay, webhook, Telegram, import, analytics, EA, live feed). `repo.ts` seeds/retires `strategy_versions`.
- `src/app/api/**` — API routes; `src/app/(main)/**` — pages. Backtest UI is `src/app/(main)/analytics/page.tsx`.
- `data/market/` — bundled price data (gz binaries, read with fs; see `outputFileTracingIncludes` in `next.config.mjs`).
- `supabase/migrations/` — SQL migrations. `public/pine/` (live indicators), `pine/` (older/research), `public/ea/` (MT5 EA), `scripts/research/` (Python research), `templates/` (CSV/payload templates).
- Path alias `@/*` → `src/*`.

## Code style

- TypeScript strict. 2-space indent, single quotes, semicolons, no ESLint/Prettier config — match the surrounding code.
- Code, comments, identifiers and commit messages in **English**. User-facing UI text, Telegram messages and README in **Indonesian**.
- Numbers in Indonesian text use `,` for decimals and `.` for thousands (e.g. `40,3%`, `+$1.464`).
- DB convention (`src/lib/server/db.ts`): every statement is a SELECT or ends with `RETURNING`; cast numeric columns to `float8` in SELECTs. The same SQL runs in tests via `psql`.
- Test fixtures are synthetic, marked TEST, dated 2030 — never use real market periods in fixtures.
- Commit messages: short imperative summary describing the user-visible change (e.g. "EA v2: file name carries the version (...)").

## Domain rules (don't break these)

- **No look-ahead.** Strategies only see candles ≤ now, zones with `valid_from ≤ now`, news available ≤ now. Signals fire on candle close; entry at next candle open.
- **Times are UTC** ("day" = UTC day). Owner's broker (Exness) server time = UTC.
- **Never edit a released strategy version in place.** Rule changes = new version string (e.g. `volbreak-v5` → `v6`) in `methods-meta.ts`; retire the old one in `repo.ts` so its DB results stay. EA file name carries its version (`XAU_v2_EA_v114.mq5`).
- When a live strategy's rules change, keep these in sync: adapter, Pine (`public/pine/xau_v*.pine`), EA (`public/ea/`), live signal/Telegram, risk calculator (`src/lib/core/risk-stats.ts`), and README.
- Default costs = owner's Exness Raw Spread account (`src/lib/core/broker.ts`); other pairs use `instruments.ts`. Default RR 1:2, risk $10/trade in reported results.
- Only strategies in `STRAT_ORDER` / `VISIBLE_STRATEGIES` (analytics page) appear on the website. **Research/experimental strategies stay off the live website** unless the owner explicitly asks to publish them.
- The website never places orders; automated trading only happens in the owner's MT5 EA. The EA has not been run from this environment — say so and recommend demo testing.
- Never log or expose secrets (Telegram token, webhook secret, EA key).

## Reporting results

- Backtest result summaries the owner expects: trades (and per month/week), win %, total $, PF, drawdown ($ and R), split 2004–2017 vs 2018–2026, and the cost assumptions used.
- A rule/filter is accepted only if it improves both periods (2004–17 and 2018–26).
- Document each shipped change as a new dated `## 5x.` section in `README.md` (Indonesian).
