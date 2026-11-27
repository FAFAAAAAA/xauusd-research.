import { randomUUID } from 'node:crypto';
import { api, readJson } from '@/lib/server/api';
import { HttpError } from '@/lib/server/db';
import * as repo from '@/lib/server/repo';
import { cleanTrade, journalStats, type JournalTrade } from '@/lib/core/journal';

export const dynamic = 'force-dynamic';
const KEY = 'live_journal';
const MAX = 3000;

type Db = Parameters<Parameters<typeof api>[0]>[0];
/**
 * One-time correction (9 Nov 2026): the first four Binance bot trades (old bot version) were recorded with the signal close price as entry, and WLD as
 * "manual −0.20" (bot bug). Values copied from Binance → Riwayat Posisi (times in UTC). Applied until all three are found.
 */
const FIX_KEY = 'journal_fix_binance_20261109b';
const FIXES = [
  { sym: 'FILUSDT', open: Date.UTC(2026, 10, 8, 8, 0, 29), close: Date.UTC(2026, 10, 8, 17, 14, 55), result: 'tp', entry: 0.776, exit: 0.7571, pnl: 7.33 },
  { sym: 'WLDUSDT', open: Date.UTC(2026, 10, 8, 16, 0, 51), close: Date.UTC(2026, 10, 8, 21, 55, 17), result: 'tp', entry: 0.3262, exit: 0.3102, pnl: 19.17 },
  { sym: 'SANDUSDT', open: Date.UTC(2026, 10, 9, 0, 0, 51), close: Date.UTC(2026, 10, 9, 0, 58, 32), result: 'sl', entry: 0.04076, exit: 0.04138, pnl: -12.16 },
  { sym: 'APTUSDT', open: Date.UTC(2026, 10, 9, 8, 0, 44), close: Date.UTC(2026, 10, 9, 8, 56, 9), result: 'sl', entry: 0.56237, exit: 0.5765, pnl: -10.66 },
] as const;
const applyFixes = async (db: Db, all: JournalTrade[]) => {
  if (await repo.getAppSetting<boolean>(db, FIX_KEY, false)) return all;
  let found = 0, changed = false;
  for (const f of FIXES) {
    const i = all.findIndex((t) => t.strategy === 'snr' && (t.note ?? '').includes(f.sym) && Math.abs(t.openedAt - f.open) < 2 * 3_600_000);
    if (i < 0 || all[i].result === 'open') continue;
    found++;
    const t = all[i];
    if (t.result !== f.result || t.entry !== f.entry || t.exit !== f.exit || t.pnl !== f.pnl || t.closedAt !== f.close) {
      all[i] = { ...t, result: f.result, entry: f.entry, exit: f.exit, pnl: f.pnl, closedAt: f.close }; changed = true;
    }
  }
  if (changed) await repo.setAppSetting(db, KEY, all);
  if (found === FIXES.length) await repo.setAppSetting(db, FIX_KEY, true);
  return all;
};
/** One-time correction (23 Nov 2026): bot / EA stops that filled past their SL (TP) were booked as "manual" (e.g. WLD 23 Nov). Same rule as new reports. */
const SLIP_KEY = 'journal_fix_slipped_stops_20261123';
const fixSlipped = async (db: Db, all: JournalTrade[]) => {
  if (await repo.getAppSetting<boolean>(db, SLIP_KEY, false)) return all;
  let changed = false;
  all.forEach((t, i) => {
    if (t.result !== 'manual' || !/^(Bot|EA)/.test(t.note ?? '') || !Number.isFinite(Number(t.exit))) return;
    const d = t.side === 'BUY' ? 1 : -1, x = Number(t.exit), r1 = Math.abs(t.entry - t.sl);
    if (!(r1 > 0)) return;
    const res = (x - t.sl) * d <= 0.25 * r1 ? 'sl' : (x - t.tp) * d >= -0.25 * r1 ? 'tp' : null;
    if (res) { all[i] = { ...t, result: res }; changed = true; }
  });
  if (changed) await repo.setAppSetting(db, KEY, all);
  await repo.setAppSetting(db, SLIP_KEY, true);
  return all;
};
const load = async (db: Db) => {
  const v = await repo.getAppSetting<JournalTrade[]>(db, KEY, []);
  return fixSlipped(db, await applyFixes(db, Array.isArray(v) ? v : []));
};
const view = (trades: JournalTrade[]) => ({
  trades: [...trades].sort((a, b) => b.openedAt - a.openedAt),
  stats: { all: journalStats(trades), v1: journalStats(trades, 'v1'), v2: journalStats(trades, 'v2'), v3: journalStats(trades, 'v3'), nas: journalStats(trades, 'nas'), btc: journalStats(trades, 'btc'), alt: journalStats(trades, 'alt'), snr: journalStats(trades, 'snr'), mb: journalStats(trades, 'mb'), lst: journalStats(trades, 'lst'), z7: journalStats(trades, 'z7'), bz: journalStats(trades, 'bz') },
});

/** Owner's manual live-trade journal (stored as one JSON value in app_settings). */
export async function GET() {
  return api(async (db) => {
    // one database round trip for everything the Trade page needs (fast first load)
    const v = await repo.getAppSettings(db, [KEY, FIX_KEY, SLIP_KEY, 'binance_balance', 'mt5_balance', 'cashflow_binance', 'cashflow_mt5']);
    const raw = Array.isArray(v[KEY]) ? (v[KEY] as JournalTrade[]) : [];
    const fixed = v[FIX_KEY] ? raw : await applyFixes(db, raw);
    const trades = v[SLIP_KEY] ? fixed : await fixSlipped(db, fixed);
    return { ...view(trades), binance: v.binance_balance ?? null, mt5: v.mt5_balance ?? null, cashflow: { crypto: v.cashflow_binance ?? [], forex: v.cashflow_mt5 ?? [] } };
  });
}

export async function POST(req: Request) {
  return api(async (db) => {
    const t = cleanTrade(await readJson(req), randomUUID());
    if (typeof t === 'string') throw new HttpError(422, t);
    const all = await load(db);
    if (all.length >= MAX) throw new HttpError(422, `Jurnal penuh (${MAX} trade)`);
    all.push(t);
    await repo.setAppSetting(db, KEY, all);
    return view(all);
  });
}

export async function PUT(req: Request) {
  return api(async (db) => {
    const b = await readJson(req);
    const all = await load(db);
    const i = all.findIndex((x) => x.id === b.id);
    if (i < 0) throw new HttpError(404, 'Trade tidak ditemukan');
    const t = cleanTrade({ ...all[i], ...b }, all[i].id);
    if (typeof t === 'string') throw new HttpError(422, t);
    all[i] = t;
    await repo.setAppSetting(db, KEY, all);
    return view(all);
  });
}

export async function DELETE(req: Request) {
  return api(async (db) => {
    const u = new URL(req.url), cf = u.searchParams.get('cf');
    if (cf) {
      // delete one deposit / withdraw; its id is remembered so the bot / EA report never adds it back
      const k = u.searchParams.get('m') === 'forex' ? 'cashflow_mt5' : 'cashflow_binance';
      const v = await repo.getAppSettings(db, [k, `${k}_deleted`]);
      const have = Array.isArray(v[k]) ? (v[k] as Array<{ id: string }>) : [];
      const next = have.filter((c) => c.id !== cf);
      if (next.length === have.length) throw new HttpError(404, 'Catatan tidak ditemukan');
      const gone = Array.isArray(v[`${k}_deleted`]) ? (v[`${k}_deleted`] as string[]) : [];
      await repo.setAppSetting(db, k, next);
      await repo.setAppSetting(db, `${k}_deleted`, [...gone, cf].slice(-1000));
      return null;
    }
    const id = u.searchParams.get('id');
    const all = await load(db);
    const next = all.filter((x) => x.id !== id);
    if (next.length === all.length) throw new HttpError(404, 'Trade tidak ditemukan');
    await repo.setAppSetting(db, KEY, next);
    return view(next);
  });
}
