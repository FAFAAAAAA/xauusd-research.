import type { Db } from './db';
import { toMs, toNum } from './db';
import * as repo from './repo';
import { computeMetrics, groupMetrics, zoneOutcomeCounts, type TradeRecord } from '../core/metrics';
import type { SessionLabel } from '../core/time';

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
  return {
    hasData: overall !== null,
    overall,
    byYear: groupMetrics(trades, (t) => String(new Date(t.entryTime).getUTCFullYear())),
    bySession: groupMetrics(trades, (t) => t.session),
    byNews: groupMetrics(trades, (t) => (t.newsConfirmed == null ? null : t.newsConfirmed ? 'with_news' : 'without_news')),
    zoneOutcomes: zoneOutcomeCounts(trades),
    comparison: [] as Array<{ profile: string; sessions: number; metrics: ReturnType<typeof computeMetrics> }>,
    sessions: sessions.map((s) => ({ ...s, period_start: toMs(s.period_start), period_end: toMs(s.period_end) })),
    trades: rows,
  };
}
