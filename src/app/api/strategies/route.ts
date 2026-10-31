import { api } from '@/lib/server/api';
import * as repo from '@/lib/server/repo';
import { getAdapter } from '@/lib/core/strategy/registry';

export const dynamic = 'force-dynamic';

export async function GET() {
  return api(async (db) => (await repo.listStrategyVersions(db)).map((s) => {
    const a = getAdapter(s.adapter_key);
    return { ...s, configured: a.configured, testOnly: a.testOnly, adapterName: a.name };
  }));
}
