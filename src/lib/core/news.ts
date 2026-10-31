import type { SentimentLabel } from './types';

export const NEWS_CATEGORIES = [
  'FOMC', 'US_CPI', 'US_PCE', 'NFP', 'UNEMPLOYMENT', 'US_TREASURY_YIELD', 'DXY', 'GEOPOLITICAL', 'GOLD_NEWS', 'OTHER',
] as const;
export type NewsCategory = (typeof NEWS_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<NewsCategory, string> = {
  FOMC: 'Federal Reserve / FOMC',
  US_CPI: 'US CPI',
  US_PCE: 'US PCE',
  NFP: 'Non-Farm Payrolls',
  UNEMPLOYMENT: 'Unemployment Rate',
  US_TREASURY_YIELD: 'US Treasury Yield',
  DXY: 'US Dollar Index',
  GEOPOLITICAL: 'Geopolitical Risk',
  GOLD_NEWS: 'Gold Market News',
  OTHER: 'Lainnya',
};

export interface EconomicEventRecord {
  id: string;
  title: string;
  category: NewsCategory;
  currency: string | null;
  impact: 'low' | 'medium' | 'high' | 'unknown';
  scheduledAt: number;
  scheduleAvailableAt: number | null;
  forecast: number | null;
  previous: number | null;
  actual: number | null;
  actualAvailableAt: number | null;
  sourceUrl: string | null;
  provider: string;
}

/**
 * The view of an economic event as it existed at market time `asOf`.
 * - Schedule unknown yet → event hidden entirely.
 * - Actual not yet available → actual = null (forecast/previous are pre-release info and remain visible).
 */
export function eventAsOf(e: EconomicEventRecord, asOf: number): (EconomicEventRecord & { released: boolean }) | null {
  if (e.scheduleAvailableAt != null && e.scheduleAvailableAt > asOf) return null;
  const released = e.actual != null && e.actualAvailableAt != null && e.actualAvailableAt <= asOf;
  return { ...e, actual: released ? e.actual : null, actualAvailableAt: released ? e.actualAvailableAt : null, released };
}

/**
 * Rule-based "surprise" sentiment for gold, method `rule_surprise_v0`.
 * Only classifies when actual AND forecast exist; otherwise Unknown.
 * Mapping is the widely cited textbook relationship (stronger US data → stronger USD/yields →
 * typically negative for gold). It is a CONFIRMATION input only, never a standalone signal,
 * and confidence is deliberately capped low.
 */
export const SENTIMENT_METHOD = 'rule_surprise_v0';
const DIRECTION: Partial<Record<NewsCategory, 1 | -1>> = {
  // +1: actual above forecast is USD-positive (gold-negative); -1: the reverse
  US_CPI: 1,
  US_PCE: 1,
  NFP: 1,
  UNEMPLOYMENT: -1,
};

export interface SentimentResult {
  label: SentimentLabel;
  confidence: number | null;
  reasoning: string;
  method: string;
}

export function surpriseSentiment(e: Pick<EconomicEventRecord, 'category' | 'actual' | 'forecast' | 'currency' | 'title'>): SentimentResult {
  const dir = DIRECTION[e.category];
  if (!dir) {
    return { label: 'Unknown', confidence: null, method: SENTIMENT_METHOD, reasoning: `Tidak ada aturan otomatis untuk kategori ${CATEGORY_LABEL[e.category]}; perlu analisis manual.` };
  }
  if (e.currency && e.currency.toUpperCase() !== 'USD') {
    return { label: 'Unknown', confidence: null, method: SENTIMENT_METHOD, reasoning: 'Aturan hanya berlaku untuk rilis USD.' };
  }
  if (e.actual == null || e.forecast == null) {
    return { label: 'Unknown', confidence: null, method: SENTIMENT_METHOD, reasoning: 'Actual atau forecast tidak tersedia.' };
  }
  const diff = e.actual - e.forecast;
  if (diff === 0) {
    return { label: 'Neutral', confidence: 0.3, method: SENTIMENT_METHOD, reasoning: `Actual (${e.actual}) sama dengan forecast.` };
  }
  const usdPositive = Math.sign(diff) === dir;
  const rel = Math.abs(diff) / Math.max(Math.abs(e.forecast), 1e-9);
  const confidence = Math.min(0.6, 0.3 + rel); // capped: heuristic, not proof
  return {
    label: usdPositive ? 'Bearish' : 'Bullish',
    confidence: Number(confidence.toFixed(3)),
    method: SENTIMENT_METHOD,
    reasoning: `${e.title}: actual ${e.actual} vs forecast ${e.forecast} → kejutan ${usdPositive ? 'positif' : 'negatif'} untuk USD, ` +
      `umumnya ${usdPositive ? 'menekan' : 'mendukung'} emas. Heuristik; hanya konfirmasi, bukan sinyal.`,
  };
}

/** Wording guard: we only claim temporal association, never causation. */
export function relationText(deltaSeconds: number): string {
  const mins = Math.round(Math.abs(deltaSeconds) / 60);
  return deltaSeconds >= 0
    ? `Berkaitan dengan berita (tersedia ${mins} menit sebelum event)`
    : `Berkaitan dengan berita (dijadwalkan ${mins} menit setelah event)`;
}
