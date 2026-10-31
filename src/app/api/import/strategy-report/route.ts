import { api, readJson, reqStr, optStr } from '@/lib/server/api';
import { importStrategyReportCsv } from '@/lib/server/import-service';

export async function POST(req: Request) {
  return api(async (db) => {
    const b = await readJson(req);
    return importStrategyReportCsv(db, reqStr(b.text, 'text', 4_000_000), {
      name: reqStr(b.name, 'name', 120), chartTimezone: reqStr(b.chart_timezone ?? 'UTC', 'chart_timezone', 64),
      timeframe: optStr(b.timeframe, 4), isTest: b.is_test === true,
    });
  });
}
