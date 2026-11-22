/* The "company" side of the office (15 Nov 2026): the owner runs the trading like a small business.
 *  - income = closed trade P&L (fees already included), costs = the owner's own monthly costs (VPS, internet …, written in Rupiah),
 *  - net profit per calendar month (display time zone), a salary = X% of net profit — only from profit above the previous high
 *    (a loss must be won back first), the rest stays in the account as capital,
 *  - every transfer Futures → Spot (and every MT5 payout) is a withdrawal: it first takes what the owner is owed (paid costs + salary);
 *    taking more becomes a cash advance (kasbon), repaid from the next salary or a deposit; unpaid salary is kept 3 months, then joins the capital,
 *  - a balance sheet, a monthly salary slip, closed months (books), a cost budget and bill reminders.
 * Pure functions only: the same numbers on the server (Telegram) and in the browser (office). */
import { tzOffsetMinutes, zonedWallTimeToUtc } from './time';
import type { JournalTrade } from './journal';

export type CostKind = 'monthly' | 'once' | 'install';
export interface Cost { id: string; name: string; idr: number; kind: CostKind; months: number; day: number; start: string; end: string | null; created: number }
export interface CompanySettings {
  target: number;                       // net profit target per month, USD
  salaryPct: number;                    // % of new net profit paid as salary
  budgetIdr: number;                    // monthly cost budget, Rupiah (0 = none)
  wdFee: { fixed: number; pct: number }; // estimated cost of one withdrawal: USDT + % (deliberately on the high side)
  costs: Cost[];
  paid: Record<string, string[]>;       // cost id → months marked "sudah bayar"
  tg: { monthly: boolean; weekly: boolean; bills: boolean };
  officeBills: boolean;
  mt5: 'off' | 'prop' | 'own';          // off: MT5 is still a trial, left out of the company; prop: only its profit / payouts count; own: its balance is the owner's money
  startBinance: number;                 // Binance balance before the first recorded trade (for the balance-sheet check)
  since: string;                        // the company starts this month (YYYY-MM): trades, money moves and costs before it are left out
  mt5v?: 3;                             // set once the owner chose the MT5 mode himself after 22 Nov 2026 (older saved settings → MT5 own)
}
export const DEFAULT_COMPANY: CompanySettings = {
  target: 200, salaryPct: 30, budgetIdr: 0, wdFee: { fixed: 1, pct: 1 }, costs: [], paid: {},
  tg: { monthly: true, weekly: true, bills: true }, officeBills: true, mt5: 'own', startBinance: 199.02, since: '2026-11',
};
export interface Fx { rate: number | null; at: number; byMonth: Record<string, number> }     // Rupiah per 1 USD
export interface MonthBook { ym: string; revenue: number; costs: number; fees: number; costIdr: number; rate: number | null; trades: number; tp: number; sl: number }
export interface CashMove { id: string; at: number; amount: number; asset?: string; type?: string }

const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const num = (v: unknown, lo: number, hi: number, d: number) => { const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const txt = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[<>&"]/g, '').trim().slice(0, max) : '');

/** validates settings coming from the browser (anything unknown is dropped) */
export function cleanCompany(raw: unknown): CompanySettings {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>, d = DEFAULT_COMPANY;
  const wd = (b.wdFee ?? {}) as Record<string, unknown>, tg = (b.tg ?? {}) as Record<string, unknown>;
  const costs: Cost[] = [];
  for (const c of Array.isArray(b.costs) ? b.costs.slice(0, 40) : []) {
    const o = (c ?? {}) as Record<string, unknown>;
    const name = txt(o.name, 40), id = txt(o.id, 40).replace(/[^0-9A-Za-z_-]/g, '');
    const idr = num(o.idr, 0, 1e11, 0), start = typeof o.start === 'string' && YM.test(o.start) ? o.start : '';
    if (!name || !id || !(idr > 0) || !start) continue;
    const kind: CostKind = o.kind === 'once' || o.kind === 'install' ? o.kind : 'monthly';
    const end = typeof o.end === 'string' && YM.test(o.end) && o.end >= start ? o.end : null;
    costs.push({ id, name, idr: Math.round(idr), kind, months: Math.round(num(o.months, 1, 120, 12)), day: Math.round(num(o.day, 1, 31, 1)), start, end, created: num(o.created, 0, 4e12, Date.now()) });
  }
  const paid: Record<string, string[]> = {};
  const p0 = (b.paid && typeof b.paid === 'object' ? b.paid : {}) as Record<string, unknown>;
  for (const c of costs) { const v = p0[c.id]; if (Array.isArray(v)) paid[c.id] = [...new Set(v.filter((x): x is string => typeof x === 'string' && YM.test(x)))].sort().slice(-36); }
  return {
    target: num(b.target, 0, 1e9, d.target), salaryPct: num(b.salaryPct, 0, 100, d.salaryPct), budgetIdr: Math.round(num(b.budgetIdr, 0, 1e12, 0)),
    wdFee: { fixed: num(wd.fixed, 0, 1000, d.wdFee.fixed), pct: num(wd.pct, 0, 20, d.wdFee.pct) },
    costs, paid,
    tg: { monthly: tg.monthly !== false, weekly: tg.weekly !== false, bills: tg.bills !== false },
    officeBills: b.officeBills !== false, mt5: b.mt5v === 3 && (b.mt5 === 'off' || b.mt5 === 'prop') ? b.mt5 : 'own', /* 22 Nov 2026: MT5 is a real-money own account → in the company unless chosen otherwise after that */ startBinance: num(b.startBinance, 0, 1e9, d.startBinance), mt5v: b.mt5v === 3 ? 3 : undefined, since: typeof b.since === 'string' && YM.test(b.since) ? b.since : '2026-11',
  };
}

/* ---------- calendar in the display time zone ---------- */
const local = (ms: number, tz: string) => new Date(ms + tzOffsetMinutes(ms, tz) * 60_000);       // read with getUTC*
export const ymOf = (ms: number, tz: string) => { const d = local(ms, tz); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
export const addYm = (ym: string, n: number) => { const [y, m] = ym.split('-').map(Number), i = y * 12 + (m - 1) + n; return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`; };
export const ymStart = (ym: string, tz: string) => { const [y, m] = ym.split('-').map(Number); return zonedWallTimeToUtc(y, m, 1, 0, 0, 0, tz); };
const daysIn = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
/** due moment of a cost in a month (its day, clamped to the month's length), 00:00 local */
export const dueAt = (c: Cost, ym: string, tz: string) => { const [y, m] = ym.split('-').map(Number); return zonedWallTimeToUtc(y, m, Math.min(c.day, daysIn(ym)), 0, 0, 0, tz); };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const MONTHS_L = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
export const ymName = (ym: string, long = false) => { const [y, m] = ym.split('-').map(Number); return long ? `${MONTHS_L[m - 1]} ${y}` : MONTHS[m - 1]; };
/** local calendar parts (dow: 0 = Sunday) */
export const tzLocalParts = (ms: number, tz: string) => { const d = local(ms, tz); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), dow: d.getUTCDay() }; };
export const dayName = (ms: number, tz: string) => { const d = local(ms, tz); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };

/** Rupiah amount of a cost in a month (0 when not charged that month) */
export function costIdrIn(c: Cost, ym: string): number {
  if (ym < c.start || (c.end && ym > c.end)) return 0;
  if (c.kind === 'once') return ym === c.start ? c.idr : 0;
  if (c.kind === 'install') return ym <= addYm(c.start, c.months - 1) ? c.idr / c.months : 0;
  return c.idr;
}
/** Rupiah per USD for a month: that month's rate (kept = locked once the month is over), else the nearest known one */
export function rateFor(fx: Fx | null, ym: string): number | null {
  if (!fx) return null;
  if (fx.byMonth[ym]) return fx.byMonth[ym];
  const ks = Object.keys(fx.byMonth).sort();
  const before = ks.filter((k) => k < ym).pop(), after = ks.find((k) => k > ym);
  return (before && fx.byMonth[before]) || (after && fx.byMonth[after]) || fx.rate || null;
}

export interface CompanyInput {
  trades: JournalTrade[]; cashflow?: { crypto?: CashMove[]; forex?: CashMove[] } | null;
  binance?: { wallet: number } | null; mt5?: { wallet: number } | null;
  settings: CompanySettings; fx: Fx | null; books?: Record<string, MonthBook>; now: number; tz: string;
}
const isMt5 = (t: JournalTrade) => t.strategy === 'v2' || t.strategy === 'v1' || t.strategy === 'nas';
export const wdFeeOf = (s: CompanySettings, w: number) => (w > 0 ? s.wdFee.fixed + (s.wdFee.pct / 100) * w : 0);

/** the raw numbers of one month (also what gets stored when the month's books are closed) */
export function monthBook(inp: CompanyInput, ym: string, withdrawals: Array<{ at: number; amount: number }>): MonthBook {
  const { tz, settings } = inp, a = ymStart(ym, tz), b = ymStart(addYm(ym, 1), tz);
  const T = inp.trades.filter((t) => t.result !== 'open' && t.pnl != null && t.closedAt != null && t.closedAt >= a && t.closedAt < b);
  const rate = rateFor(inp.fx, ym);
  const costIdr = settings.costs.reduce((s, c) => s + costIdrIn(c, ym), 0);
  const fees = withdrawals.filter((w) => w.at >= a && w.at < b).reduce((s, w) => s + wdFeeOf(settings, w.amount), 0);
  return { ym, revenue: T.reduce((s, t) => s + Number(t.pnl), 0), costs: rate ? costIdr / rate : 0, fees, costIdr, rate, trades: T.length, tp: T.filter((t) => t.result === 'tp').length, sl: T.filter((t) => t.result === 'sl').length };
}

export interface MonthRow extends MonthBook { deficit: number; net: number; salary: number; capital: number; closed: boolean; deduct: number; taken: number; unclaimed: number; expired: number }
export interface Bill { cost: Cost; ym: string; due: number; daysLeft: number; usd: number | null }
export interface CompanyReport {
  ym: string; months: MonthRow[]; cur: MonthRow;
  owed: { costs: number; salaryNow: number; salaryOld: number; advance: number; avail: number; fee: number; allowed: number; takenNow: number };
  week: { from: number; revenue: number; trades: number; tp: number; sl: number };
  sheet: { assets: number; liabilities: number; equity: number; parts: Array<[string, number]>; expected: number | null; diff: number | null };
  moves: Move[];
  budget: { used: number; limit: number; pct: number | null };
  bills: Bill[]; rate: number | null; noRate: boolean;
}

export type Move = { id: string; at: number; amount: number; kind: 'in' | 'out'; market: 'crypto' | 'forex' };
/** money in / out: Binance transfers both ways (Futures → Spot = withdrawal); MT5: payouts always, deposits only for an own account */
export function moneyMoves(inp: Pick<CompanyInput, 'cashflow' | 'settings' | 'now'>): Move[] {
  const out: Move[] = [];
  for (const c of inp.cashflow?.crypto ?? []) if (c && Number.isFinite(c.amount) && c.amount !== 0 && c.at <= inp.now) out.push({ id: c.id, at: c.at, amount: Math.abs(c.amount), kind: c.amount > 0 ? 'in' : 'out', market: 'crypto' });
  if (inp.settings.mt5 !== 'off') for (const c of inp.cashflow?.forex ?? []) if (c && Number.isFinite(c.amount) && c.amount !== 0 && c.at <= inp.now && (c.amount < 0 || inp.settings.mt5 === 'own')) out.push({ id: c.id, at: c.at, amount: Math.abs(c.amount), kind: c.amount > 0 ? 'in' : 'out', market: 'forex' });
  out.sort((a, b) => a.at - b.at);
  // own MT5 account: money moved between Binance and MT5 stays inside the company (not a payout, not new capital).
  // A pair = one market out and the other market in, within 3 days and 3% of each other (transfer fees / rounding).
  if (inp.settings.mt5 === 'own') {
    const drop = new Set<string>();
    for (const a of out) {
      if (a.kind !== 'out' || drop.has(a.id)) continue;
      const b = out.find((x) => x.kind === 'in' && x.market !== a.market && !drop.has(x.id) && Math.abs(x.at - a.at) <= 3 * 86_400_000 && Math.abs(x.amount - a.amount) <= 0.03 * a.amount);
      if (b) { drop.add(a.id); drop.add(b.id); }
    }
    return out.filter((m) => !drop.has(m.id));
  }
  return out;
}
/** the input as the company sees it: MT5 trades left out while MT5 is a trial */
export function companyInput<T extends CompanyInput>(inp: T): T {
  const S = inp.settings, from = ymStart(S.since, inp.tz);
  const keep = (at: number | null | undefined) => at == null || at >= from;      // open trades / no date: kept
  return {
    ...inp,
    trades: inp.trades.filter((t) => keep(t.closedAt) && (S.mt5 !== 'off' || !isMt5(t))),
    mt5: S.mt5 === 'off' ? null : inp.mt5,
    cashflow: { crypto: (inp.cashflow?.crypto ?? []).filter((c) => c && c.at >= from), forex: (inp.cashflow?.forex ?? []).filter((c) => c && c.at >= from) },
    settings: { ...S, costs: S.costs.map((c) => (c.start < S.since ? { ...c, start: S.since } : c)).filter((c) => !c.end || c.end >= S.since) },
  };
}
/** months whose books can be closed now (first activity … last month) */
export function closableMonths(inp: CompanyInput): string[] {
  const cur = ymOf(inp.now, inp.tz), firsts = [...inp.trades.filter((t) => t.closedAt).map((t) => ymOf(t.closedAt!, inp.tz)), ...inp.settings.costs.map((c) => c.start), ...moneyMoves(inp).map((m) => ymOf(m.at, inp.tz))].sort();
  const out: string[] = []; if (!firsts.length) return out;
  for (let m = firsts[0] < addYm(cur, -60) ? addYm(cur, -60) : firsts[0]; m < cur; m = addYm(m, 1)) out.push(m);
  return out;
}
/** everything the accountant's report shows */
export function companyReport(inp0: CompanyInput): CompanyReport {
  const inp = companyInput(inp0);
  const { tz, now, settings: S } = inp;
  const cur = ymOf(now, tz);
  // money in / out: Binance transfers (both ways); MT5: payouts always, deposits only for an own account
  const moves = moneyMoves(inp);
  const outs = moves.filter((m) => m.kind === 'out');
  // first month: first trade / cost / money move
  const firsts = [...inp.trades.filter((t) => t.closedAt).map((t) => ymOf(t.closedAt!, tz)), ...S.costs.map((c) => c.start), ...moves.map((m) => ymOf(m.at, tz)), cur].sort();
  const first = firsts[0] < addYm(cur, -60) ? addYm(cur, -60) : firsts[0];
  const yms: string[] = []; for (let m = first; m <= cur; m = addYm(m, 1)) yms.push(m);
  // per month: closed months use their stored books (numbers frozen), the current one is live
  const rows: MonthRow[] = [];
  let cum = 0, peak = 0;
  for (const ym of yms) {
    // closed month: income, withdrawal fees and the rate are frozen; costs follow the cost list (so a cost entered later still counts)
    const old = ym < cur ? inp.books?.[ym] : undefined, live = monthBook(inp, ym, outs);
    const bk: MonthBook = old ? { ...old, costIdr: live.costIdr, costs: old.rate ? live.costIdr / old.rate : live.costs } : live;
    const net = bk.revenue - bk.costs - bk.fees;
    const deficit = Math.max(0, peak - cum);              // loss from earlier months still to win back
    cum += net;
    const salary = Math.max(0, cum - peak) * (S.salaryPct / 100);
    peak = Math.max(peak, cum);
    rows.push({ ...bk, deficit, net, salary, capital: net - salary, closed: ym < cur, deduct: 0, taken: 0, unclaimed: 0, expired: 0 });
  }
  // what the company owes the owner: buckets (costs he paid from his pocket + salary), oldest first
  type Bucket = { ym: string; kind: 'cost' | 'salary'; left: number };
  const buckets: Bucket[] = [];
  let advance = 0;
  const row = (ym: string) => rows.find((r) => r.ym === ym);
  const credit = (ym: string, kind: Bucket['kind'], amt: number) => {
    if (!(amt > 0)) return;
    const pay = Math.min(advance, amt); advance -= pay;                    // a cash advance is repaid first
    if (kind === 'salary') { const r = row(ym); if (r) r.deduct += pay; }
    if (amt - pay > 1e-9) buckets.push({ ym, kind, left: amt - pay });
  };
  const expire = (t: number) => {                                            // salary not taken within 3 months joins the capital
    for (const bk of buckets) if (bk.kind === 'salary' && bk.left > 0 && t >= ymStart(addYm(bk.ym, 4), tz)) { const r = row(bk.ym); if (r) r.expired += bk.left; bk.left = 0; }
  };
  // events in time order: month credits at the month's end (the current month: now), withdrawals, deposits
  type Evt = { at: number; k: 0 | 1 | 2; ym?: string; amount?: number };
  const ev: Evt[] = rows.map((r) => ({ at: r.closed ? ymStart(addYm(r.ym, 1), tz) : now, k: 0 as const, ym: r.ym }));
  for (const m of moves) ev.push({ at: m.at, k: m.kind === 'out' ? 1 : 2, amount: m.amount });
  ev.sort((a, b) => a.at - b.at || b.k - a.k);                               // same moment: money moves before the month credit
  let takenNow = 0;
  const curStart = ymStart(cur, tz);
  for (const e of ev) {
    expire(e.at);
    if (e.k === 0) { const r = row(e.ym!)!; credit(r.ym, 'cost', r.costs); credit(r.ym, 'salary', r.salary); continue; }
    if (e.k === 2) { advance -= Math.min(advance, e.amount!); continue; }     // a deposit repays a cash advance first, the rest is capital
    if (e.at >= curStart) takenNow += e.amount!;
    let need = e.amount! - wdFeeOf(S, e.amount!);                             // what reached the owner's pocket (estimate)
    for (const bk of buckets) {
      if (need <= 1e-9) break;
      const t = Math.min(bk.left, need); bk.left -= t; need -= t;
      if (bk.kind === 'salary') { const r = row(bk.ym); if (r) r.taken += t; }
    }
    if (need > 1e-9) advance += need;
  }
  expire(now);
  for (const bk of buckets) if (bk.kind === 'salary' && bk.left > 0) { const r = row(bk.ym); if (r) r.unclaimed += bk.left; }
  const left = (f: (b: Bucket) => boolean) => buckets.filter(f).reduce((s, b) => s + b.left, 0);
  const owedCosts = left((b) => b.kind === 'cost'), salaryNow = left((b) => b.kind === 'salary' && b.ym === cur), salaryOld = left((b) => b.kind === 'salary' && b.ym !== cur);
  const avail = owedCosts + salaryNow + salaryOld;
  const p = S.wdFee.pct / 100;
  const allowed = avail > 0.005 && p < 1 ? (avail + S.wdFee.fixed) / (1 - p) : 0;     // the withdrawal that leaves `avail` after its own fee
  // this week (Monday 00:00 local)
  const d = local(now, tz), dow = (d.getUTCDay() + 6) % 7;
  const wFrom = zonedWallTimeToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate() - dow, 0, 0, 0, tz);
  const W = inp.trades.filter((t) => t.result !== 'open' && t.pnl != null && t.closedAt != null && t.closedAt >= wFrom && t.closedAt <= now);
  // balance sheet: assets = Binance (+ MT5 own account, or the MT5 profit not paid out yet for a prop account) + cash advance
  const bin = inp.binance?.wallet ?? null;
  const mt5Profit = inp.trades.filter((t) => isMt5(t) && t.result !== 'open' && t.pnl != null).reduce((s, t) => s + Number(t.pnl), 0) - outs.filter((m) => m.market === 'forex').reduce((s, m) => s + m.amount, 0);
  const parts: Array<[string, number]> = [];
  if (bin != null) parts.push(['Binance', bin]);
  if (S.mt5 !== 'off' && (S.mt5 === 'own' ? inp.mt5 : inp.trades.some(isMt5))) parts.push([S.mt5 === 'own' ? 'MT5' : 'Laba MT5 belum dicairkan', S.mt5 === 'own' ? inp.mt5!.wallet : mt5Profit]);
  if (advance > 0.005) parts.push(['Kasbon', advance]);
  const assets = parts.reduce((s, [, v]) => s + v, 0);
  // check: what the Binance balance should be from the books
  const crypto = inp.trades.filter((t) => !isMt5(t) && t.result !== 'open' && t.pnl != null).reduce((s, t) => s + Number(t.pnl), 0);
  const cm = moves.filter((m) => m.market === 'crypto').reduce((s, m) => s + (m.kind === 'in' ? m.amount : -m.amount), 0);
  const expected = bin != null ? S.startBinance + crypto + cm : null;
  const curRow = rows[rows.length - 1];
  const rate = rateFor(inp.fx, cur);
  // bills: from 3 days before the due day until marked paid (only due dates after the cost was entered)
  const bills: Bill[] = [];
  for (const c of S.costs) for (const ym of [addYm(cur, -2), addYm(cur, -1), cur, addYm(cur, 1)]) {
    if (!costIdrIn(c, ym) || (S.paid[c.id] ?? []).includes(ym)) continue;
    const due = dueAt(c, ym, tz);
    if (due < c.created - 86_400_000 || now < due - 3 * 86_400_000) continue;
    bills.push({ cost: c, ym, due, daysLeft: Math.ceil((due - now) / 86_400_000), usd: rateFor(inp.fx, ym) ? costIdrIn(c, ym) / rateFor(inp.fx, ym)! : null });
  }
  bills.sort((a, b) => a.due - b.due);
  return {
    ym: cur, months: rows, cur: curRow,
    owed: { costs: owedCosts, salaryNow, salaryOld, advance, avail, fee: allowed ? allowed - avail : 0, allowed, takenNow },
    week: { from: wFrom, revenue: W.reduce((s, t) => s + Number(t.pnl), 0), trades: W.length, tp: W.filter((t) => t.result === 'tp').length, sl: W.filter((t) => t.result === 'sl').length },
    sheet: { assets, liabilities: avail, equity: assets - avail, parts, expected, diff: expected != null && bin != null ? bin - expected : null },
    moves: moves.slice().reverse(),
    budget: { used: curRow.costIdr, limit: S.budgetIdr, pct: S.budgetIdr > 0 ? (curRow.costIdr / S.budgetIdr) * 100 : null },
    bills, rate, noRate: !rate && S.costs.length > 0,
  };
}

/* ---------- formatting ---------- */
export const usdT = (n: number, sign = false) => `${n < 0 ? '−' : sign && n > 0 ? '+' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const idrT = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;
export const toIdr = (usd: number, rate: number | null) => (rate ? `± ${idrT(Math.abs(usd) * rate)}` : '');

/** Telegram texts (HTML) */
export function weeklyText(r: CompanyReport, tz: string): string {
  const w = r.week;
  return `📊 <b>Ringkasan minggu ini</b> (${dayName(w.from, tz)} – Minggu)\n\n${w.revenue >= 0 ? 'Untung' : 'Rugi'}: <b>${usdT(w.revenue, true)}</b> ${toIdr(w.revenue, r.rate)}\n${w.trades} trade selesai · ${w.tp} TP · ${w.sl} SL`;
}
export function monthlyText(r: CompanyReport, s: CompanySettings): string {
  const c = r.cur, o = r.owed;
  const lines = [
    `🏢 <b>Laporan perusahaan ${ymName(c.ym, true)}</b>`, '',
    `Pendapatan: ${usdT(c.revenue, true)}`, `Operasional: ${usdT(-(c.costs + c.fees))}`, `<b>Laba bersih: ${usdT(c.net, true)}</b> ${toIdr(c.net, r.rate)}`,
    '', `Gaji ${s.salaryPct}%: <b>${usdT(c.salary)}</b> ${toIdr(c.salary, r.rate)}`, `Pengembangan modal: ${usdT(c.capital, true)}`,
    `Boleh ditarik: <b>${usdT(o.allowed)}</b> ${toIdr(o.allowed, r.rate)}`, o.advance > 0.005 ? `Kasbon: ${usdT(o.advance)}` : '',
  ];
  return lines.filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n').trim();
}
export function billText(b: Bill): string {
  return `🧾 <b>Hari ini bayar ${b.cost.name}</b>\n\n${idrT(costIdrIn(b.cost, b.ym))}${b.usd ? ` (± ${usdT(b.usd)})` : ''}\nSudah bayar? Tandai di Kantor → Menu → Perusahaan.`;
}
