import { api, reqUuid } from '@/lib/server/api';
import { HttpError, toNum } from '@/lib/server/db';
import * as repo from '@/lib/server/repo';
import { loadNewsWindow, snapshotAt } from '@/lib/server/news-service';
import { isTimeframe, TIMEFRAME_MS } from '@/lib/core/types';
import { tradeChartWindow } from '@/lib/core/trade-chart';
import { fileProvider, parseFileSource } from '@/lib/server/market-files';

export const dynamic = 'force-dynamic';

/** Trade review: chart around entry, setup reason, news known AT ENTRY, outcome. */
export async function GET(_: Request, { params }: { params: { id: string } }) {
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
    const chartTimeframe = file?.tf ?? tf;
    const window = tradeChartWindow(entry, exit, TIMEFRAME_MS[chartTimeframe]);
    if (file) {
      candles = fileProvider(file.symbol, file.tf).between(file.tf, window.from, window.to);
    } else if (t.source_id) {
      candles = await repo.candlesBetween(db, String(t.source_id), tf, window.from, window.to, 10000);
    }

    const news = snapshotAt(await loadNewsWindow(db, entry, entry), entry);
    return {
      trade: { id, side: t.side, timeframe: tf, entry, exit, entryPrice: t.entry_px, exitPrice: t.exit_px, stopLoss: t.sl, takeProfit: t.tp,
        pnl: t.pnl_f, exitReason: t.exit_reason, setupReason: t.setup_reason, origin: t.origin, isTest: t.is_test },
      candles, chartTimeframe, newsAtEntry: news,
    };
  });
}
