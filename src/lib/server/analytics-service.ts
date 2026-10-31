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
  const rows = await repo.listTrades(db, backtestSessionId);
  const trades = rows.map(rowToTrade);
  const overall = computeMetrics(trades);
  const sessions = await repo.listBacktestSessions(db);
  // Comparison slots A–D: only filled from sessions that were actually run with that profile.
  const profiles = ['snr_only', 'snr_news', 'snr_trend_momentum', 'snr_all'] as const;
  const comparison = [] as Array<{ profile: string; sessions: number; metrics: ReturnType<typeof computeMetrics> }>;
  for (const p of profiles) {
    const ids = sessions.filter((s) => s.confirmation_profile === p && Number(s.trades) > 0).map((s) => String(s.id));
    if (!ids.length) { comparison.push({ profile: p, sessions: 0, metrics: null }); continue; }
    const all: TradeRecord[] = [];
    for (const id of ids) all.push(...(await repo.listTrades(db, id)).map(rowToTrade));
    comparison.push({ profile: p, sessions: ids.length, metrics: computeMetrics(all) });
  }
  return {
    hasData: overall !== null,
    overall,
    byYear: groupMetrics(trades, (t) => String(new Date(t.entryTime).getUTCFullYear())),
    byTimeframe: groupMetrics(trades, (t) => t.timeframe),
    bySession: groupMetrics(trades, (t) => t.session),
    byNews: groupMetrics(trades, (t) => (t.newsConfirmed == null ? null : t.newsConfirmed ? 'with_news' : 'without_news')),
    zoneOutcomes: zoneOutcomeCounts(trades),
    comparison,
    sessions: sessions.map((s) => ({ ...s, period_start: toMs(s.period_start), period_end: toMs(s.period_end) })),
    trades: rows,
  };
}
