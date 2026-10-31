import type { Db } from './db';
import * as repo from './repo';
import { CATEGORY_LABEL, eventAsOf, surpriseSentiment, type EconomicEventRecord } from '../core/news';
import type { NewsSnapshot } from '../core/strategy/adapter';
import { DATA_UNAVAILABLE } from '../core/types';

const LOOKBACK_MS = 24 * 3_600_000;
const LOOKAHEAD_MS = 24 * 3_600_000;

export interface NewsWindow {
  archiveAvailable: boolean;
  econ: (EconomicEventRecord & { unit: string | null; isTest: boolean })[];
  articles: Awaited<ReturnType<typeof repo.articlesAvailableInWindow>>;
  sentiments: Awaited<ReturnType<typeof repo.sentimentsFor>>;
}

/** Load raw news once for a span of market time; per-candle views are derived with snapshotAt(). */
export async function loadNewsWindow(db: Db, from: number, to: number): Promise<NewsWindow> {
  const archiveAvailable = await repo.newsArchiveCoverage(db, from) || await repo.newsArchiveCoverage(db, to);
  if (!archiveAvailable) return { archiveAvailable, econ: [], articles: [], sentiments: new Map() };
  const econ = await repo.economicEventsInWindow(db, from - LOOKBACK_MS, to + LOOKAHEAD_MS);
  const articles = await repo.articlesAvailableInWindow(db, from - LOOKBACK_MS, to);
  const sentiments = await repo.sentimentsFor(db, econ.map((e) => e.id));
  return { archiveAvailable, econ, articles, sentiments };
}

/** Pure anti-lookahead view at market time `now`. */
export function snapshotAt(w: NewsWindow, now: number): NewsSnapshot {
  if (!w.archiveAvailable) return { archiveAvailable: false, items: [], upcoming: [] };
  const items: NewsSnapshot['items'] = [];
  const upcoming: NewsSnapshot['upcoming'] = [];
  for (const raw of w.econ) {
    const e = eventAsOf(raw, now);
    if (!e) continue;
    if (e.released && e.actualAvailableAt! > now - LOOKBACK_MS) {
      const s = w.sentiments.get(e.id);
      items.push({
        kind: 'economic', id: e.id, title: e.title, category: e.category, impact: e.impact, availableAt: e.actualAvailableAt!,
        sentiment: s && s.availableAt <= now ? { label: s.label, confidence: s.confidence, reasoning: s.reasoning } : null,
      });
    } else if (!e.released && e.scheduledAt > now && e.scheduledAt <= now + LOOKAHEAD_MS) {
      upcoming.push({ id: e.id, title: e.title, category: e.category, impact: e.impact, scheduledAt: e.scheduledAt });
    }
  }
  for (const a of w.articles) {
    if (a.availableAt <= now && a.availableAt > now - LOOKBACK_MS) {
      items.push({ kind: 'article', id: a.id, title: a.title, category: a.category, availableAt: a.availableAt, sentiment: null });
    }
  }
  items.sort((a, b) => b.availableAt - a.availableAt);
  upcoming.sort((a, b) => a.scheduledAt - b.scheduledAt);
  return { archiveAvailable: true, items, upcoming };
}

/** Human-readable confirmation strings (association only — never causation). */
export function summarizeNews(s: NewsSnapshot): { news: string; sentiment: string } {
  if (!s.archiveAvailable) return { news: DATA_UNAVAILABLE, sentiment: DATA_UNAVAILABLE };
  const high = s.items.filter((i) => i.kind === 'economic' && i.impact === 'high');
  const nextHigh = s.upcoming.find((u) => u.impact === 'high');
  const parts: string[] = [];
  if (high.length) parts.push(`${high.length} rilis high-impact 24 jam terakhir (${high.slice(0, 2).map((h) => CATEGORY_LABEL[h.category as keyof typeof CATEGORY_LABEL] ?? h.title).join(', ')})`);
  if (nextHigh) parts.push(`akan datang: ${nextHigh.title} ${new Date(nextHigh.scheduledAt).toISOString().slice(11, 16)} UTC`);
  const news = parts.length ? parts.join('; ') : 'Tidak ada rilis high-impact dalam ±24 jam';
  const withSent = s.items.find((i) => i.sentiment && i.sentiment.label !== 'Unknown');
  const sentiment = withSent?.sentiment
    ? `${withSent.sentiment.label} (${withSent.title}, keyakinan ${withSent.sentiment.confidence ?? '-'})`
    : 'Unknown';
  return { news, sentiment };
}

/** Recompute rule-based sentiment for events that have actual + forecast. */
export async function refreshSentiment(db: Db, econ: EconomicEventRecord[]) {
  let n = 0;
  for (const e of econ) {
    if (e.actual == null || e.actualAvailableAt == null) continue;
    const s = surpriseSentiment(e);
    await repo.upsertSentiment(db, { economicEventId: e.id, label: s.label, confidence: s.confidence, reasoning: s.reasoning, method: s.method, availableAt: e.actualAvailableAt });
    n++;
  }
  return n;
}
