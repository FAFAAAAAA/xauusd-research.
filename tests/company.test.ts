// Company report (office accountant): synthetic TEST data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { companyReport, cleanCompany, DEFAULT_COMPANY, costIdrIn, type CompanyInput } from '../src/lib/core/company';
import type { JournalTrade } from '../src/lib/core/journal';

const TZ = 'Asia/Seoul';
const at = (y: number, m: number, d: number, h = 12) => Date.UTC(y, m - 1, d, h - 9);       // Seoul wall time → UTC
let n = 0;
const tr = (closedAt: number, pnl: number, strategy = 'snr'): JournalTrade => ({ id: String(n++), strategy, side: 'SELL', openedAt: closedAt - 3_600_000, entry: 1, sl: 1.1, tp: 0.8, lot: 1, closedAt, exit: 1, result: pnl > 0 ? 'tp' : 'sl', pnl, note: 'Bot Binance OPUSDT' });
const base = (over: Partial<CompanyInput> = {}): CompanyInput => ({
  trades: [], cashflow: { crypto: [], forex: [] }, binance: { wallet: 0 }, mt5: null,
  settings: cleanCompany({ ...DEFAULT_COMPANY, wdFee: { fixed: 0, pct: 0 } }), fx: { rate: 16000, at: 0, byMonth: { '2026-09': 16000, '2026-10': 16000, '2026-11': 16000 } },
  now: at(2026, 11, 15), tz: TZ, ...over,
});
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 0.01, `${a} ≈ ${b}`);

test('net profit = income − costs (Rupiah converted), salary 30%', () => {
  const s = cleanCompany({ ...DEFAULT_COMPANY, wdFee: { fixed: 0, pct: 0 }, costs: [{ id: 'vps', name: 'VPS', idr: 320000, kind: 'monthly', day: 12, start: '2026-10', created: at(2026, 10, 1) }] });
  const r = companyReport(base({ settings: s, trades: [tr(at(2026, 11, 3), 100)] }));
  near(r.cur.costs, 20); near(r.cur.net, 80); near(r.cur.salary, 18); near(r.cur.capital, 62);   // October's $20 cost (no income) is covered first
  near(r.owed.costs, 40);          // October + November VPS still owed to the owner
  near(r.owed.salaryNow, 18);
});

test('a loss must be won back before the next salary (high-water mark)', () => {
  const r = companyReport(base({ trades: [tr(at(2026, 9, 5), 100), tr(at(2026, 10, 5), -60), tr(at(2026, 11, 5), 80)] }));
  const [sep, oct, nov] = r.months;
  near(sep.salary, 30); near(oct.salary, 0); near(nov.salary, 6);   // only the 20 above the old peak of 100
});

test('withdrawing more than owed becomes a cash advance, repaid from the next salary or a deposit', () => {
  const crypto = [{ id: 'w1', at: at(2026, 10, 20), amount: -50 }];
  const r = companyReport(base({ trades: [tr(at(2026, 10, 5), 100), tr(at(2026, 11, 5), 100)], cashflow: { crypto } }));
  // October: withdrew 50 before the month closed; October salary 30 repays 30 → 20 advance left; November salary 30 repays it → 10 owed
  near(r.months[0].deduct, 30); near(r.months[1].deduct, 20); near(r.owed.advance, 0); near(r.owed.salaryNow, 10);
  const r2 = companyReport(base({ trades: [tr(at(2026, 10, 5), 100)], cashflow: { crypto: [...crypto, { id: 'd1', at: at(2026, 11, 2), amount: 1000 }] } }));
  near(r2.owed.advance, 0);       // the deposit paid the remaining 20
});

test('salary not taken for 3 months joins the capital', () => {
  const r = companyReport(base({ trades: [tr(at(2026, 6, 5), 100)], now: at(2026, 11, 15) }));
  near(r.months[0].expired, 30); near(r.owed.avail, 0);
  const r2 = companyReport(base({ trades: [tr(at(2026, 9, 5), 100)], now: at(2026, 11, 15) }));
  near(r2.owed.salaryOld, 30);
});

test('withdrawal fee estimate: allowed amount covers its own fee', () => {
  const s = cleanCompany({ ...DEFAULT_COMPANY, wdFee: { fixed: 1, pct: 1 } });
  const r = companyReport(base({ settings: s, trades: [tr(at(2026, 11, 3), 100)] }));
  const a = r.owed.allowed; near(a - (1 + 0.01 * a), r.owed.avail);
});

test('costs: once / installments / end month; bills from 3 days before until paid', () => {
  const c = { id: 'x', name: 'Laptop', idr: 1200, kind: 'install' as const, months: 12, day: 1, start: '2026-10', end: null, created: 0 };
  assert.equal(costIdrIn(c, '2026-10'), 100); assert.equal(costIdrIn(c, '2027-09'), 100); assert.equal(costIdrIn(c, '2027-10'), 0);
  const vps = { id: 'vps', name: 'VPS', idr: 320000, kind: 'monthly', day: 17, start: '2026-10', created: at(2026, 11, 1) };
  const s = cleanCompany({ ...DEFAULT_COMPANY, costs: [vps] });
  assert.equal(companyReport(base({ settings: s })).bills.length, 1);                                    // 17 Nov is 2 days away
  assert.equal(companyReport(base({ settings: s, now: at(2026, 11, 13) })).bills.length, 0);            // 4 days away
  assert.equal(companyReport(base({ settings: cleanCompany({ ...s, paid: { vps: ['2026-11'] } }) })).bills.length, 0);
});
