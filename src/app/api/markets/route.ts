import { api } from '@/lib/server/api';
import { datasets, ensureDatasetSources } from '@/lib/server/market-files';
import { instrumentSpec } from '@/lib/core/instruments';

export const dynamic = 'force-dynamic';

/** Price datasets bundled with the website (one per symbol and base timeframe), with their source ids. */
export async function GET() {
  return api(async (db) => {
    const ids = await ensureDatasetSources(db);
    return datasets().map((d) => {
      const s = instrumentSpec(d.symbol);
      return { ...d, source_id: ids.get(d.key) ?? null, label: s?.label ?? d.symbol, group: s?.group ?? 'Lainnya',
        costs: s ? { spread: s.spread, slippage: s.slippage, commission: s.commission } : null };
    });
  });
}
