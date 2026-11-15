import type { Db } from './db';
import * as repo from './repo';
import { sendTelegram, type FetchLike } from './telegram';
import { formatInTz } from '../core/time';

/**
 * The big US news coming up (CPI, FOMC, NFP, PCE, Powell): office countdown board, the reminder chip and the Telegram reminder.
 * Source: the public Forex Factory weekly calendar (this week + next week, cached 1 hour),
 * plus any high-impact event imported into the database. Nothing is invented: no source = empty list.
 */
/** impact: Forex Factory colour — high = red, medium = yellow (owner, 15 Nov 2026: USD red + yellow on the office board; reminders stay red only) */
export type Ev = { title: string; at: number; impact: 'high' | 'medium'; name?: string };
const LABEL: Array<[RegExp, string]> = [
  [/non-?farm|\bnfp\b/i, 'NFP'],
  [/\bcpi\b/i, 'CPI'],
  [/fomc|federal funds rate/i, 'FOMC'],
  [/\bpce\b/i, 'PCE'],
  [/powell|fed chair/i, 'POWELL'],
];
const label = (t: string) => LABEL.find(([r]) => r.test(t))?.[1] ?? null;
// short names for the small office board (other USD red / yellow news); unknown titles are cut to their first words
const SHORT: Array<[RegExp, string]> = [
  [/ism manufacturing/i, 'ISM MFG'], [/ism services/i, 'ISM JASA'], [/jolts/i, 'JOLTS'], [/\bppi\b/i, 'PPI'], [/\bgdp\b/i, 'GDP'], [/\badp\b/i, 'ADP'],
  [/unemployment claims/i, 'KLAIM PHK'], [/unemployment rate/i, 'PENGANGGURAN'], [/average hourly/i, 'UPAH'], [/retail sales/i, 'RETAIL'],
  [/consumer confidence/i, 'CB CONF'], [/uom|michigan/i, 'UOM'], [/durable goods/i, 'DURABLE'], [/crude oil/i, 'MINYAK'], [/flash manufacturing pmi/i, 'PMI MFG'],
  [/flash services pmi/i, 'PMI JASA'], [/fomc.*minutes/i, 'FOMC NOTULEN'], [/(speaks|testifies)/i, 'PIDATO FED'], [/new home sales/i, 'RUMAH BARU'],
  [/existing home sales/i, 'RUMAH'], [/empire state/i, 'EMPIRE'], [/philly|philadelphia/i, 'PHILLY FED'], [/trade balance/i, 'NERACA'], [/treasury|bond auction/i, 'LELANG OBLIGASI'],
];
const short = (t: string) => label(t) ?? SHORT.find(([r]) => r.test(t))?.[1] ?? t.replace(/\s+[mqy]\/[mqy]$/i, '').toUpperCase().split(/\s+/).slice(0, 2).join(' ');

async function ff(week: 'thisweek' | 'nextweek'): Promise<Ev[]> {
  try {
    const r = await fetch(`https://nfs.faireconomy.media/ff_calendar_${week}.json`, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) return [];
    const rows = await r.json();
    if (!Array.isArray(rows)) return [];
    const out: Ev[] = [];
    for (const x of rows) {
      const imp = String(x?.impact).toLowerCase();
      if (x?.country !== 'USD' || (imp !== 'high' && imp !== 'medium')) continue;
      const full = String(x.title ?? '').trim(), at = Date.parse(String(x.date ?? ''));
      if (full && Number.isFinite(at)) out.push({ title: short(full), at, impact: imp === 'high' ? 'high' : 'medium', name: full });
    }
    return out;
  } catch { return []; }
}

export async function bigNews(db: Db, now = Date.now()): Promise<Ev[]> {
    const [a, b] = await Promise.all([ff('thisweek'), ff('nextweek')]);
    let fromDb: Ev[] = [];
    try {
      fromDb = (await repo.economicEventsInWindow(db, now - 3_600_000, now + 10 * 86_400_000))
        .filter((e) => (e.impact === 'high' || e.impact === 'medium') && (e.scheduleAvailableAt == null || e.scheduleAvailableAt <= now))
        .map((e) => ({ title: label(e.title) ?? (e.category === 'US_CPI' ? 'CPI' : e.category === 'US_PCE' ? 'PCE' : e.category === 'FOMC' ? 'FOMC' : e.category === 'NFP' ? 'NFP' : short(e.title)), at: e.scheduledAt, impact: (e.impact === 'high' ? 'high' : 'medium') as Ev['impact'], name: e.title }))
        .filter((e) => e.title);
    } catch { /* database optional here */ }
    // one entry per name and time (several CPI lines are released at the same minute)
    const seen = new Set<string>(), events: Ev[] = [];
    for (const e of [...a, ...b, ...fromDb].sort((x, y) => x.at - y.at)) {
      const k = `${e.title}:${Math.round(e.at / 60_000)}`;
      if (seen.has(k) || e.at < now - 3_600_000) continue;
      seen.add(k); events.push(e);
    }
  return events.slice(0, 40);
}

/** watchdog tick (~every 10 min): one Telegram reminder per big US news, sent 0–60 minutes before it */
export async function runNewsReminder(db: Db, now = Date.now(), fetchImpl?: FetchLike) {
  const tg = await repo.getTelegramSettings(db);
  if (!tg.live_enabled) return [];
  const tz = await repo.getAppSetting<string>(db, 'display_timezone', 'UTC');
  const soon = (await bigNews(db, now)).filter((e) => e.impact === 'high' && e.at > now && e.at - now <= 60 * 60_000);   // Telegram: red news only
  const sent: string[] = [];
  for (const e of soon) {
    const min = Math.max(1, Math.round((e.at - now) / 60_000));
    const text = `📅 <b>${e.title} ${min} menit lagi</b> (${formatInTz(e.at, tz).slice(-5)})\n\nBerita besar bisa membuat harga bergerak liar dan menyapu SL.\nMau jeda bot sementara? Ketuk <b>Jeda bot</b> di kantor, atau Atur → Kontrol bot.`;
    const r = await sendTelegram(db, { deliveryKey: `news:${e.title}:${e.at}`, mode: 'LIVE', text }, { fetchImpl });
    if (r.status === 'sent') sent.push(e.title);
  }
  return sent;
}
