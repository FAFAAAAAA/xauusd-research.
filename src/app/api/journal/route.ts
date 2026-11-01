import { randomUUID } from 'node:crypto';
import { api, readJson } from '@/lib/server/api';
import { HttpError } from '@/lib/server/db';
import * as repo from '@/lib/server/repo';
import { cleanTrade, journalStats, type JournalTrade } from '@/lib/core/journal';

export const dynamic = 'force-dynamic';
const KEY = 'live_journal';
const MAX = 3000;

const load = async (db: Parameters<Parameters<typeof api>[0]>[0]) => {
  const v = await repo.getAppSetting<JournalTrade[]>(db, KEY, []);
  return Array.isArray(v) ? v : [];
};
const view = (trades: JournalTrade[]) => ({
  trades: [...trades].sort((a, b) => b.openedAt - a.openedAt),
  stats: { all: journalStats(trades), v1: journalStats(trades, 'v1'), v2: journalStats(trades, 'v2') },
});

/** Owner's manual live-trade journal (stored as one JSON value in app_settings). */
export async function GET() {
  return api(async (db) => view(await load(db)));
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
    const id = new URL(req.url).searchParams.get('id');
    const all = await load(db);
    const next = all.filter((x) => x.id !== id);
    if (next.length === all.length) throw new HttpError(404, 'Trade tidak ditemukan');
    await repo.setAppSetting(db, KEY, next);
    return view(next);
  });
}
