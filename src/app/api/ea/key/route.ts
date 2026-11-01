import { api } from '@/lib/server/api';
import { eaKeyInfo, newEaKey } from '@/lib/server/ea-service';
import { getConfig } from '@/lib/server/config';

export const dynamic = 'force-dynamic';

export async function GET() {
  return api(async (db) => {
    const cfg = getConfig();
    return { ...(await eaKeyInfo(db)), reportUrl: cfg.appBaseUrl ? `${cfg.appBaseUrl}/api/ea/report` : null };
  });
}
/** Creates a NEW key (the old one stops working). The key is returned once; only its hash is stored. */
export async function POST() {
  return api(async (db) => ({ key: await newEaKey(db) }));
}
