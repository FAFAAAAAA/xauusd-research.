import type { Db } from './db';
import { toMs, toNum } from './db';
import * as repo from './repo';
import { computeMetrics, groupMetrics, zoneOutcomeCounts, type TradeRecord } from '../core/metrics';
import type { SessionLabel } from '../core/time';
import { regimeAt, regimeSeries } from '../core/regime';
import { datasets, fileProvider } from './market-files';

export function rowToTrade(r: Record<string, unknown>): TradeRecord {
  return {
    id: String(r.id), entryTime: Number(r.entry_ms), exitTime: toNum(r.exit_ms), pnl: toNum(r.pnl), pnlR: toNum(r.pnl_r),
    plannedRr: toNum(r.planned_rr), timeframe: (r.timeframe as string) ?? null, session: (r.session_label as SessionLabel) ?? null,
    newsConfirmed: (r.news_confirmed as boolean) ?? null, zoneOutcome: (r.zone_outcome as TradeRecord['zoneOutcome']) ?? null,
  };
}

export async function analytics(db: Db, backtestSessionId: string | string[] | null) {
  // Without a session only the session list is returned (cheap); the page then asks for one result.
  const [rows, sessions] = await Promise.all([
    backtestSessionId ? repo.listTrades(db, backtestSessionId, { light: true }) : Promise.resolve([] as Record<string, unknown>[]),
    repo.listBacktestSessions(db),
  ]);
  const trades = rows.map(rowToTrade);
  const overall = computeMetrics(trades);
  // market condition (uptrend / downtrend / sideways) at each entry, from D1 of the bundled price file of that symbol
  let byRegime: ReturnType<typeof groupMetrics> = [];
  try {
    const ids = backtestSessionId == null ? [] : Array.isArray(backtestSessionId) ? backtestSessionId : [backtestSessionId];
    const s0 = sessions.find((s) => ids.includes(String(s.id)));
    const sym = String((s0?.cost_config as Record<string, unknown> | undefined)?.symbol ?? s0?.symbol ?? 'XAUUSD');
    const ds = datasets().find((d) => d.symbol === sym && d.tf === 'M15') ?? datasets().find((d) => d.symbol === sym);
    if (ds && trades.length) {
      const t0 = Math.min(...trades.map((t) => t.entryTime)), t1 = Math.max(...trades.map((t) => t.entryTime));
      const d1 = fileProvider(ds.symbol, ds.tf).between('D1', t0 - 400 * 86_400_000, t1 + 86_400_000);
      const ser = regimeSeries(d1);
      byRegime = groupMetrics(trades, (t) => regimeAt(d1, ser, t.entryTime));
    }
  } catch { byRegime = []; }
  return {
    hasData: overall !== null,
    overall,
    byYear: groupMetrics(trades, (t) => String(new Date(t.entryTime).getUTCFullYear())),
    bySession: groupMetrics(trades, (t) => t.session),
    byNews: groupMetrics(trades, (t) => (t.newsConfirmed == null ? null : t.newsConfirmed ? 'with_news' : 'without_news')),
    zoneOutcomes: zoneOutcomeCounts(trades),
    byRegime,
    comparison: [] as Array<{ profile: string; sessions: number; metrics: ReturnType<typeof computeMetrics> }>,
    sessions: sessions.map((s) => ({ ...s, period_start: toMs(s.period_start), period_end: toMs(s.period_end) })),
    trades: rows,
  };
}
