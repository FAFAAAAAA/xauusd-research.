import { api, readJson, reqStr, reqUuid } from '@/lib/server/api';
import { HttpError } from '@/lib/server/db';
import { runBacktest } from '@/lib/server/backtest-service';
import { parseTimestamp } from '@/lib/core/time';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  return api(async (db) => {
    const b = await readJson(req);
    const from = parseTimestamp(reqStr(b.from, 'from'));
    const to = parseTimestamp(reqStr(b.to, 'to'));
    if (from === null || to === null) throw new HttpError(422, 'Tanggal harus ISO, mis. 2019-01-01T00:00:00Z');
    const rr = Array.isArray(b.rr) ? (b.rr as unknown[]).map(Number).filter((x) => Number.isFinite(x) && x > 0) : undefined;
    const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : undefined);
    const c = (b.costs ?? {}) as Record<string, unknown>;
    const costs = Object.fromEntries(Object.entries({
      spread: num(c.spread), slippage: num(c.slippage), commissionPerUnit: num(c.commissionPerUnit),
      ambiguityPolicy: ['worst', 'best', 'skip'].includes(c.ambiguityPolicy as string) ? c.ambiguityPolicy : undefined,
    }).filter(([, v]) => v !== undefined));
    return runBacktest(db, {
      sourceId: reqUuid(b.source_id, 'source_id'), from, to,
      strategyVersionId: typeof b.strategy_version_id === 'string' && b.strategy_version_id ? reqUuid(b.strategy_version_id, 'strategy_version_id') : null,
      rrList: rr, costs, size: num(b.size), riskUsd: num(b.risk_usd) ?? null, name: typeof b.name === 'string' ? b.name.slice(0, 120) : null,
    });
  });
}
