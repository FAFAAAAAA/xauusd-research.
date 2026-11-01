import { formatInTz } from './time';
import type { EventType, Mode, Timeframe } from './types';
import { NOT_CONFIGURED } from './types';

const EVENT_TEXT: Record<EventType, string> = {
  SNR_NEAR: 'Mendekati',
  SNR_TOUCH: 'Menyentuh',
  SNR_BREAKOUT: 'Breakout',
  SNR_RETEST: 'Retest',
  SETUP_CONFIRMED: 'Setup terkonfirmasi',
  SETUP_INVALIDATED: 'Setup batal',
};

export function eventLabel(type: EventType, zoneKind: string | null | undefined, tf: Timeframe): string {
  const zone = zoneKind === 'support' ? 'Support' : zoneKind === 'resistance' ? 'Resistance' : 'Zona SNR';
  if (type.startsWith('SETUP_')) return `${EVENT_TEXT[type]} ${tf}`;
  return `${EVENT_TEXT[type]} ${zone} ${tf}`;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface TelegramEventMessage {
  mode: Mode;
  eventType: EventType;
  timeframe: Timeframe;
  eventTime: number;
  price: number;
  zoneLow: number | null;
  zoneHigh: number | null;
  zoneKind: string | null;
  confirmations: { trend?: string; momentum?: string; news?: string; sentiment?: string };
  status: string;
  displayTimezone: string;
  replaySessionId?: string;
  strategyLabel: string;
  isTest?: boolean;
  linkUrl?: string | null;
  /** LIVE signal from the v1/v2 Pine indicators: shown as entry / SL / TP / lot instead of the SNR zone */
  trade?: { side: 'BUY' | 'SELL'; entry: number; sl: number; tp: number; lot: number | null; riskUsd: number | null; riskPct: number | null };
}

const fmtPrice = (n: number | null) => (n == null ? '—' : n.toFixed(2));

export function buildEventMessage(m: TelegramEventMessage): { text: string; button?: { text: string; url: string }; copy?: Array<{ text: string; value: string }> } {
  const c = (v?: string) => escapeHtml(v ?? NOT_CONFIGURED);
  const zone = m.zoneLow != null && m.zoneHigh != null ? `${fmtPrice(m.zoneLow)} – ${fmtPrice(m.zoneHigh)}` : '—';
  const tzNote = m.displayTimezone === 'UTC' ? 'UTC' : m.displayTimezone;
  const testTag = m.isTest ? '\n⚠️ <b>TEST FIXTURE</b> — data/aturan uji teknis\n' : '';
  const lines: string[] = [];
  if (m.mode === 'LIVE') {
    const t = m.trade;
    if (t) {
      lines.push(
        `${t.side === 'BUY' ? '🟢' : '🔴'} <b>XAUUSD — ${t.side}</b> · LIVE${testTag}`,
        `<b>Strategi:</b> ${escapeHtml(m.strategyLabel)}`,
        '',
        `<b>Entry ≈</b> <code>${fmtPrice(t.entry)}</code> <i>(harga close; isi di open candle berikutnya)</i>`,
        `<b>SL:</b> <code>${fmtPrice(t.sl)}</code>  (jarak ${Math.abs(t.entry - t.sl).toFixed(2)})`,
        `<b>TP:</b> <code>${fmtPrice(t.tp)}</code>  (RR 1:${(Math.abs(t.tp - t.entry) / Math.abs(t.entry - t.sl)).toFixed(1)})`,
        t.lot != null && t.lot > 0 ? `<b>Lot:</b> <code>${t.lot.toFixed(2)}</code>  (risiko ≈ $${(t.riskUsd ?? 0).toFixed(2)}${t.riskPct ? ` = ${t.riskPct}% modal` : ''})`
          : t.lot === 0 ? '<b>Lot:</b> di bawah 0,01 — modal/risiko terlalu kecil untuk SL ini' : '<b>Lot:</b> atur modal & risiko di menu Trade',
        '',
        `<b>News:</b> ${c(m.confirmations.news)}`,
        `<b>Waktu:</b> ${formatInTz(m.eventTime, m.displayTimezone)} (${escapeHtml(tzNote)})`,
        '',
        '<i>Sinyal dari indikator. Pasang order sendiri — tidak ada order otomatis.</i>',
      );
      const text = lines.join('\n');
      const button = m.linkUrl && /^https:\/\//.test(m.linkUrl) ? { text: 'Buka menu Trade', url: m.linkUrl } : undefined;
      const copy = [{ text: 'Salin entry', value: fmtPrice(t.entry) }, { text: 'Salin SL', value: fmtPrice(t.sl) }, { text: 'Salin TP', value: fmtPrice(t.tp) }];
      if (t.lot != null && t.lot > 0) copy.push({ text: 'Salin lot', value: t.lot.toFixed(2) });
      return { text: text + '\n<i>Ketuk angka atau tombol untuk menyalin.</i>', button, copy };
    }
    lines.push(
      `🔔 <b>XAUUSD — LIVE</b>${testTag}`,
      '',
      `<b>Event:</b> ${escapeHtml(eventLabel(m.eventType, m.zoneKind, m.timeframe))}`,
      `<b>Harga:</b> ${fmtPrice(m.price)}`,
      `<b>Zona SNR:</b> ${zone}`,
      '',
      '<b>Konfirmasi:</b>',
      `• Trend: ${c(m.confirmations.trend)}`,
      `• Momentum: ${c(m.confirmations.momentum)}`,
      `• News: ${c(m.confirmations.news)}`,
      `• Sentiment: ${c(m.confirmations.sentiment)}`,
      '',
      `<b>Status:</b> ${escapeHtml(m.status)}`,
      `<b>Waktu:</b> ${formatInTz(m.eventTime, m.displayTimezone)} (${escapeHtml(tzNote)})`,
      `<b>Strategi:</b> ${escapeHtml(m.strategyLabel)}`,
    );
  } else {
    const year = new Date(m.eventTime).getUTCFullYear();
    const local = formatInTz(m.eventTime, m.displayTimezone);
    const [date, time] = local.split(' ');
    const [y, mo, d] = date.split('-');
    lines.push(
      `🧪 <b>XAUUSD — BACKTEST ${year}</b>${testTag}`,
      '<b>SIMULASI HISTORIS — BUKAN SINYAL LIVE</b>',
      '',
      `<b>Tanggal pasar:</b> ${d}.${mo}.${y}`,
      `<b>Waktu pasar:</b> ${time} (${escapeHtml(tzNote)})`,
      `<b>Event:</b> ${escapeHtml(eventLabel(m.eventType, m.zoneKind, m.timeframe))}`,
      `<b>Harga historis:</b> ${fmtPrice(m.price)}`,
      `<b>Zona SNR:</b> ${zone}`,
      '',
      '<b>Konfirmasi:</b>',
      `• Trend: ${c(m.confirmations.trend)}`,
      `• News: ${c(m.confirmations.news)}`,
      `• Sentiment: ${c(m.confirmations.sentiment)}`,
      '',
      `<b>Status:</b> ${escapeHtml(m.status)}`,
      `<b>Strategi:</b> ${escapeHtml(m.strategyLabel)}`,
      `<b>Session ID:</b> <code>${escapeHtml(m.replaySessionId ?? '—')}</code>`,
    );
  }
  const text = lines.join('\n');
  // Telegram rejects non-public URLs in inline buttons; only attach for https links.
  const button = m.linkUrl && /^https:\/\//.test(m.linkUrl)
    ? { text: m.mode === 'LIVE' ? 'Buka Chart' : 'Lihat Replay', url: m.linkUrl }
    : undefined;
  return { text, button };
}

export function buildTestMessage(now: number, tz: string): string {
  return [
    '✅ <b>XAUUSD Research — Test Notification</b>',
    'Koneksi bot Telegram berhasil. Pesan ini bukan sinyal pasar.',
    `Waktu server: ${formatInTz(now, tz, true)} (${escapeHtml(tz)})`,
  ].join('\n');
}
