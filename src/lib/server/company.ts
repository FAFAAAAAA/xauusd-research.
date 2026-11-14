import type { Db } from './db';
import * as repo from './repo';
import { sendTelegram, type FetchLike } from './telegram';
import type { JournalTrade } from '../core/journal';
import { DEFAULT_COMPANY, billText, cleanCompany, closableMonths, companyInput, companyReport, moneyMoves, monthBook, monthlyText, weeklyText, ymOf, tzLocalParts,
  type CompanyInput, type CompanySettings, type Fx, type MonthBook } from '../core/company';

/* Company (office accountant) on the server: settings, the Rupiah rate and closed books live in app_settings.
 * The rate comes from free public exchange-rate services, at most every 6 hours; each month keeps its last rate (locked once the month is over). */
const SET = 'company_settings', FX = 'fx_idr', BOOKS = 'company_books_v2';      // v2: books closed without the MT5 trial
type Get = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

async function fetchIdr(get: Get): Promise<number | null> {
  const sources: Array<[string, (j: any) => unknown]> = [
    ['https://open.er-api.com/v6/latest/USD', (j) => j?.rates?.IDR],
    ['https://api.frankfurter.app/latest?from=USD&to=IDR', (j) => j?.rates?.IDR],
  ];
  for (const [url, pick] of sources) {
    try {
      const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 4000);
      const r = await get(url, { signal: ctrl.signal }); clearTimeout(t);
      if (!r.ok) continue;
      const v = Number(pick(await r.json()));
      if (v > 5000 && v < 50000) return v;          // sanity: Rupiah per dollar
    } catch { /* next source */ }
  }
  return null;
}

export async function companyData(db: Db, now = Date.now(), get: Get = fetch as unknown as Get) {
  const v = await repo.getAppSettings(db, [SET, FX, BOOKS, 'live_journal', 'binance_balance', 'mt5_balance', 'cashflow_binance', 'cashflow_mt5', 'display_timezone']);
  const tz = typeof v.display_timezone === 'string' ? v.display_timezone : 'UTC';
  const settings = cleanCompany(v[SET] ?? DEFAULT_COMPANY);
  let fx = (v[FX] as Fx | undefined) ?? { rate: null, at: 0, byMonth: {} };
  if (now - (fx.at ?? 0) > 6 * 3_600_000) {
    const rate = await fetchIdr(get);
    fx = rate ? { rate, at: now, byMonth: { ...(fx.byMonth ?? {}), [ymOf(now, tz)]: rate } } : { ...fx, at: now - 5 * 3_600_000 };   // failed: retry in ~1 h
    await repo.setAppSetting(db, FX, fx);
  }
  const books = { ...((v[BOOKS] as Record<string, MonthBook> | undefined) ?? {}) };
  const inp: CompanyInput = companyInput({
    trades: Array.isArray(v.live_journal) ? (v.live_journal as JournalTrade[]) : [],
    cashflow: { crypto: (v.cashflow_binance as never) ?? [], forex: (v.cashflow_mt5 as never) ?? [] },
    binance: (v.binance_balance as never) ?? null, mt5: (v.mt5_balance as never) ?? null, settings, fx, books, now, tz,
  });
  // close the books of every finished month once (its numbers stay as they were)
  const outs = moneyMoves(inp).filter((m) => m.kind === 'out');
  let closed = false;
  for (const ym of closableMonths(inp)) if (!books[ym]) { books[ym] = monthBook(inp, ym, outs); closed = true; }
  if (closed) await repo.setAppSetting(db, BOOKS, books);
  return { settings, fx, books, tz, inp: { ...inp, books } };
}

export async function saveCompany(db: Db, raw: unknown) {
  const s = cleanCompany(raw && typeof raw === 'object' ? { ...raw, mt5v: 2 } : raw);
  await repo.setAppSetting(db, SET, s);
  return s;
}
export async function markPaid(db: Db, id: string, ym: string, paid: boolean) {
  const s = cleanCompany(await repo.getAppSetting(db, SET, DEFAULT_COMPANY));
  if (!s.costs.some((c) => c.id === id) || !/^\d{4}-\d{2}$/.test(ym)) return s;
  const cur = new Set(s.paid[id] ?? []); if (paid) cur.add(ym); else cur.delete(ym);
  s.paid[id] = [...cur].sort();
  await repo.setAppSetting(db, SET, s);
  return s;
}

/** scheduled (watchdog, every ~10 min): weekly summary Saturday ≥ 22:00, monthly report on the last day ≥ 22:00, bills on their day ≥ 09:00 */
export async function runCompanyTick(db: Db, now = Date.now(), fetchImpl?: FetchLike, get?: Get) {
  const tg = await repo.getTelegramSettings(db);
  if (!tg.live_enabled) return 'off';
  const { settings: s, inp, tz } = await companyData(db, now, get);
  const p = tzLocalParts(now, tz), sent: string[] = [];
  const r = companyReport(inp);
  const send = async (key: string, text: string) => { const x = await sendTelegram(db, { deliveryKey: key, mode: 'LIVE', text }, { fetchImpl }); if (x.status === 'sent') sent.push(key); };
  const ymd = `${p.y}-${p.m}-${p.d}`;
  if (s.tg.weekly && p.dow === 6 && p.h >= 22) await send(`company:week:${ymd}`, weeklyText(r, tz));
  const last = ymOf(now + 86_400_000, tz) !== ymOf(now, tz);
  if (s.tg.monthly && last && p.h >= 22) await send(`company:month:${r.ym}`, monthlyText(r, s));
  if (s.tg.bills && p.h >= 9) for (const b of r.bills) if (b.daysLeft <= 0 && now - b.due < 86_400_000) await send(`company:bill:${b.cost.id}:${b.ym}`, billText(b));
  return sent.join(',') || 'nothing';
}
export type { CompanySettings };
