import { api, reqUuid } from '@/lib/server/api';
import { HttpError, toNum } from '@/lib/server/db';
import * as repo from '@/lib/server/repo';
import { loadNewsWindow, snapshotAt } from '@/lib/server/news-service';
import { isTimeframe, TIMEFRAME_MS } from '@/lib/core/types';
import { tradeChartWindow } from '@/lib/core/trade-chart';
import { datasets, fileProvider, parseFileSource, type BaseTf } from '@/lib/server/market-files';

export const dynamic = 'force-dynamic';

/** Trade review: chart around entry, setup reason, news known AT ENTRY, outcome. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  return api(async (db) => {
    const id = reqUuid(params.id, 'id');
    const r = await db.query<Record<string, unknown>>(
      `select t.*, extract(epoch from t.entry_time)*1000 as entry_ms, extract(epoch from t.exit_time)*1000 as exit_ms,
              t.entry_price::float8 as entry_px, t.exit_price::float8 as exit_px, t.stop_loss::float8 as sl, t.take_profit::float8 as tp,
              t.pnl::float8 as pnl_f, b.source_id, s.broker_symbol
       from simulated_trades t left join backtest_sessions b on b.id = t.backtest_session_id
       left join market_data_sources s on s.id = b.source_id where t.id = $1`, [id]);
    const t = r[0];
    if (!t) throw new HttpError(404, 'Trade tidak ditemukan');
    const entry = Number(t.entry_ms);
    const exit = toNum(t.exit_ms);
    const tf = isTimeframe(t.timeframe) ? t.timeframe : 'H1';
    let candles: Awaited<ReturnType<typeof repo.candlesUpTo>> = [];
    const file = parseFileSource(t.broker_symbol as string | null);
    // ?tf= picks the chart timeframe (M5…D1, never below the data's own timeframe); then a long history is sent:
    // up to 1200 candles before the entry and 300 after the exit, like the live trade chart
    const want = new URL(req.url).searchParams.get('tf');
    const base = file?.tf ?? tf;
    // a file-backed backtest can also use the same symbol's smaller datasets (e.g. gold M30 backtest, chart in M5 from the M5 file)
    const own = file ? datasets().filter((x) => x.symbol === file.symbol).map((x) => x.tf as BaseTf) : [];
    const minMs = Math.min(TIMEFRAME_MS[base], ...own.map((x) => TIMEFRAME_MS[x]));
    const tfs = (['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'] as const).filter((x) => TIMEFRAME_MS[x] >= minMs);
    const picked = want && isTimeframe(want) && (tfs as readonly string[]).includes(want) ? want : null;
    const chartTimeframe = picked ?? base;
    const window = picked
      ? { from: entry - (new URL(req.url).searchParams.get('wide') ? 7 : 1) * 1200 * TIMEFRAME_MS[picked], to: Math.max(entry, exit ?? entry) + (new URL(req.url).searchParams.get('wide') ? 7 : 1) * 300 * TIMEFRAME_MS[picked] + 1 }   // wide = weekly chart (D1 x 7)
      : tradeChartWindow(entry, exit, TIMEFRAME_MS[chartTimeframe]);
    if (file) {
      // read from the largest dataset that is not larger than the chart timeframe
      const src = [file.tf as BaseTf, ...own].filter((x) => TIMEFRAME_MS[x] <= TIMEFRAME_MS[chartTimeframe]).sort((a, b) => TIMEFRAME_MS[b] - TIMEFRAME_MS[a])[0] ?? (file.tf as BaseTf);
      candles = fileProvider(file.symbol, src).between(chartTimeframe, window.from, window.to);
    } else if (t.source_id) {
      candles = await repo.candlesBetween(db, String(t.source_id), chartTimeframe, window.from, window.to, 10000);
      if (!candles.length && chartTimeframe !== tf) candles = await repo.candlesBetween(db, String(t.source_id), tf, window.from, window.to, 10000);
    }

    const news = snapshotAt(await loadNewsWindow(db, entry, entry), entry);
    return {
      trade: { id, side: t.side, timeframe: tf, entry, exit, entryPrice: t.entry_px, exitPrice: t.exit_px, stopLoss: t.sl, takeProfit: t.tp,
        pnl: t.pnl_f, exitReason: t.exit_reason, setupReason: t.setup_reason, origin: t.origin, isTest: t.is_test },
      candles, chartTimeframe, tfs: file ? tfs : [base], newsAtEntry: news,
    };
  });
}
