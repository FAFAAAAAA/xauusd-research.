import { api, readJson, reqStr, optStr } from '@/lib/server/api';
import { HttpError } from '@/lib/server/db';
import * as repo from '@/lib/server/repo';

export const dynamic = 'force-dynamic';

export async function GET() {
  return api(async (db) => repo.listSources(db));
}

export async function POST(req: Request) {
  return api(async (db) => {
    const b = await readJson(req);
    const kind = String(b.kind ?? 'csv_import');
    if (!['csv_import', 'api', 'tradingview_export'].includes(kind)) throw new HttpError(422, 'kind tidak valid');
    const basis = String(b.price_basis ?? 'bid');
    if (!['bid', 'ask', 'mid', 'last', 'unknown'].includes(basis)) throw new HttpError(422, 'price_basis tidak valid');
    const tz = reqStr(b.file_timezone ?? 'UTC', 'file_timezone', 64);
    try { if (!/^(UTC)?[+-]\d{1,2}(:?\d{2})?$/.test(tz) && tz !== 'UTC') new Intl.DateTimeFormat('en-US', { timeZone: tz }); }
    catch { throw new HttpError(422, 'file_timezone bukan zona IANA yang valid (mis. Europe/Athens) atau offset (UTC+2)'); }
    const spread = Number(b.spread_points);
    return repo.createSource(db, {
      name: reqStr(b.name, 'name', 120), provider: reqStr(b.provider, 'provider', 120), kind, broker_symbol: optStr(b.broker_symbol, 60),
      file_timezone: tz, price_basis: basis,
      spread_spec: Number.isFinite(spread) ? { type: 'fixed', price_units: spread } : { type: 'unknown' },
      notes: optStr(b.notes), is_test: b.is_test === true,
    });
  });
}
