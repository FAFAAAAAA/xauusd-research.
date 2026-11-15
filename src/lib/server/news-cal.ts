import type { Db } from './db';
import * as repo from './repo';
import { sendTelegram, type FetchLike } from './telegram';
import { formatInTz } from '../core/time';

/**
 * The big US news coming up (CPI, FOMC, NFP, PCE, Powell): office countdown board, the reminder chip and the Telegram reminder.
 * Source: the public Forex Factory weekly calendar (this week + next week, cached 1 hour),
 * plus any high-impact event imported into the database. Nothing is invented: no source = empty list.
 */
export type Ev = { title: string; at: number };
const LABEL: Array<[RegExp, string]> = [
  [/non-?farm|\bnfp\b/i, 'NFP'],
  [/\bcpi\b/i, 'CPI'],
  [/fomc|federal funds rate/i, 'FOMC'],
  [/\bpce\b/i, 'PCE'],
  [/powell|fed chair/i, 'POWELL'],
];
const label = (t: string) => LABEL.find(([r]) => r.test(t))?.[1] ?? null;

async function ff(week: 'thisweek' | 'nextweek'): Promise<Ev[]> {
  try {
    const r = await fetch(`https://nfs.faireconomy.media/ff_calendar_${week}.json`, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) return [];
    const rows = await r.json();
    if (!Array.isArray(rows)) return [];
    const out: Ev[] = [];
    for (const x of rows) {
      if (x?.country !== 'USD' || String(x?.impact).toLowerCase() !== 'high') continue;
      const name = label(String(x.title ?? '')), at = Date.parse(String(x.date ?? ''));
      if (name && Number.isFinite(at)) out.push({ title: name, at });
    }
    return out;
  } catch { return []; }
}

export async function bigNews(db: Db, now = Date.now()): Promise<Ev[]> {
    const [a, b] = await Promise.all([ff('thisweek'), ff('nextweek')]);
    let fromDb: Ev[] = [];
    try {
      fromDb = (await repo.economicEventsInWindow(db, now - 3_600_000, now + 10 * 86_400_000))
        .filter((e) => e.impact === 'high' && (e.scheduleAvailableAt == null || e.scheduleAvailableAt <= now))
        .map((e) => ({ title: label(e.title) ?? (e.category === 'US_CPI' ? 'CPI' : e.category === 'US_PCE' ? 'PCE' : e.category === 'FOMC' ? 'FOMC' : e.category === 'NFP' ? 'NFP' : ''), at: e.scheduledAt }))
        .filter((e) => e.title);
    } catch { /* database optional here */ }
    // one entry per name and time (several CPI lines are released at the same minute)
    const seen = new Set<string>(), events: Ev[] = [];
    for (const e of [...a, ...b, ...fromDb].sort((x, y) => x.at - y.at)) {
      const k = `${e.title}:${Math.round(e.at / 60_000)}`;
      if (seen.has(k) || e.at < now - 3_600_000) continue;
      seen.add(k); events.push(e);
    }
  return events.slice(0, 12);
}

/** watchdog tick (~every 10 min): one Telegram reminder per big US news, sent 0–60 minutes before it */
export async function runNewsReminder(db: Db, now = Date.now(), fetchImpl?: FetchLike) {
  const tg = await repo.getTelegramSettings(db);
  if (!tg.live_enabled) return [];
  const tz = await repo.getAppSetting<string>(db, 'display_timezone', 'UTC');
  const soon = (await bigNews(db, now)).filter((e) => e.at > now && e.at - now <= 60 * 60_000);
  const sent: string[] = [];
  for (const e of soon) {
    const min = Math.max(1, Math.round((e.at - now) / 60_000));
    const text = `📅 <b>${e.title} ${min} menit lagi</b> (${formatInTz(e.at, tz).slice(-5)})\n\nBerita besar bisa membuat harga bergerak liar dan menyapu SL.\nMau jeda bot sementara? Ketuk <b>Jeda bot</b> di kantor, atau Atur → Kontrol bot.`;
    const r = await sendTelegram(db, { deliveryKey: `news:${e.title}:${e.at}`, mode: 'LIVE', text }, { fetchImpl });
    if (r.status === 'sent') sent.push(e.title);
  }
  return sent;
}
