import { api, readJson } from '@/lib/server/api';
import { HttpError } from '@/lib/server/db';
import { companyData, markPaid, saveCompany } from '@/lib/server/company';

export const dynamic = 'force-dynamic';

/** Company settings (accountant): target, salary %, costs in Rupiah, bills paid; plus the Rupiah rate and closed books. */
export async function GET() {
  return api(async (db) => { const { settings, fx, books } = await companyData(db); return { settings, fx, books }; });
}
export async function PUT(req: Request) {
  return api(async (db) => { await saveCompany(db, await readJson(req)); const { settings, fx, books } = await companyData(db); return { settings, fx, books }; });
}
/** { action: 'paid' | 'unpaid', id, ym } — "Sudah bayar" for one bill */
export async function POST(req: Request) {
  return api(async (db) => {
    const b = await readJson(req);
    if ((b.action !== 'paid' && b.action !== 'unpaid') || typeof b.id !== 'string' || typeof b.ym !== 'string') throw new HttpError(422, 'Permintaan tidak valid');
    await markPaid(db, b.id, b.ym, b.action === 'paid');
    const { settings, fx, books } = await companyData(db);
    return { settings, fx, books };
  });
}
