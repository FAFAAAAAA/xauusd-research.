import { api, readJson, reqUuid } from '@/lib/server/api';
import { HttpError } from '@/lib/server/db';
import * as repo from '@/lib/server/repo';
import { getAdapter } from '@/lib/core/strategy/registry';
import { validateDefinition } from '@/lib/core/strategy/builder';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  return api(async (db) => {
    await repo.ensureBuiltinStrategies(db);
    const [rows, custom] = await Promise.all([repo.listStrategyVersions(db), repo.customStrategySummaries(db)]);
    const info = new Map(custom.map((c) => [c.id, c]));
    return rows.map((s) => {
      const a = getAdapter(s.adapter_key);
      const c = info.get(s.id);
      return {
        ...s, configured: a.configured, testOnly: a.testOnly, adapterName: a.name, requiredTimeframes: a.requiredTimeframes ?? [],
        custom: s.adapter_key === 'custom_v1', customKind: c?.kind ?? null, signalCount: c?.signals ?? null, definition: c?.definition ?? null,
      };
    });
  });
}

/** Create a strategy from a definition (builder, uploaded .json, or signals from a .csv). */
export async function POST(req: Request) {
  return api(async (db) => {
    const b = await readJson<{ definition?: unknown }>(req);
    const v = validateDefinition(b.definition);
    if (!v.ok) throw new HttpError(422, `Strategi tidak valid: ${v.errors.slice(0, 8).join('; ')}`, { errors: v.errors });
    return repo.createCustomStrategy(db, v.def, v.def);
  });
}

/** Hide or show a strategy: { id, status: 'active' | 'retired' } */
export async function PATCH(req: Request) {
  return api(async (db) => {
    const b = await readJson(req);
    if (b.status !== 'active' && b.status !== 'retired') throw new HttpError(422, 'status harus active atau retired');
    if (!(await repo.setStrategyStatus(db, reqUuid(b.id, 'id'), b.status))) throw new HttpError(404, 'Strategi tidak ditemukan');
    return { ok: true };
  });
}

/** Delete a custom strategy: ?id=...&results=1 also deletes its backtest results. */
export async function DELETE(req: Request) {
  return api(async (db) => {
    const u = new URL(req.url);
    const id = reqUuid(u.searchParams.get('id'), 'id');
    if (!(await repo.deleteCustomStrategy(db, id, u.searchParams.get('results') === '1'))) {
      throw new HttpError(404, 'Hanya strategi buatan sendiri yang bisa dihapus (strategi bawaan bisa disembunyikan)');
    }
    return { ok: true };
  });
}
