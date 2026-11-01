import type { StrategyAdapter, StrategyEventDraft } from './adapter';
import type { EventType } from '../types';
import { snrAdapter } from './snr';
import { breakoutAdapter, breakoutV03Adapter, breakoutV04Adapter, breakoutV05Adapter, breakoutV06Adapter } from './breakout';
import { snrSndAdapter } from './snrsnd';
import { customAdapter } from './builder';
import { snrSnd2Adapter } from './snrsnd2';
import { nPatternAdapter } from './npattern';
import { rbrDbdAdapter } from './rbrdbd';
import { snrBreakAdapter } from './snrbreak';
import { obFvgAdapter } from './obfvg';
import { breakoutV07Adapter } from './npola';
import { breakoutV08Adapter, methodAdapters } from './basebrk';
import { volBreakAdapter } from './volbreak';
import { bosH1Adapter } from './bosh1';

/**
 * Placeholder for the owner's SNR strategy. It is intentionally empty:
 * the SNR rules, BUY/SELL logic, SL and TP have NOT been specified yet.
 * Replace `configured:false` + `evaluate` once the specification is provided.
 */
export const notConfiguredAdapter: StrategyAdapter = {
  key: 'not_configured',
  name: 'SNR Strategy (belum dikonfigurasi)',
  configured: false,
  testOnly: false,
  warmupCandles: 0,
  evaluate: () => [],
};

/**
 * TEST ONLY — a technical fixture used to verify the pipeline end-to-end
 * (replay → event → database → Telegram). It is NOT a trading strategy:
 *  - it only uses zones a human entered manually (origin manual/test),
 *  - it emits SNR_NEAR / SNR_TOUCH on state CHANGE (edge-triggered) so the same
 *    condition does not fire on every candle,
 *  - it never emits BUY/SELL, SL or TP.
 * params.near_distance: absolute price distance considered "near" (required, no default).
 */
export const testZoneProximityAdapter: StrategyAdapter = {
  key: 'test_zone_proximity',
  name: 'TEST — Zone Proximity Fixture',
  configured: true,
  testOnly: true,
  warmupCandles: 1,
  evaluate(ctx) {
    const dist = Number(ctx.params.near_distance);
    if (!Number.isFinite(dist) || dist < 0) return [];
    const c = ctx.candles[ctx.candles.length - 1];
    const prev = (ctx.state.zoneState ?? {}) as Record<string, string>;
    const next: Record<string, string> = {};
    const out: StrategyEventDraft[] = [];
    for (const z of ctx.zones) {
      const key = z.id ?? `${z.low}-${z.high}`;
      const touching = c.low <= z.high && c.high >= z.low;
      const distance = c.close > z.high ? c.close - z.high : c.close < z.low ? z.low - c.close : 0;
      const state = touching ? 'touch' : distance <= dist ? 'near' : 'away';
      next[key] = state;
      if (state !== 'away' && state !== prev[key]) {
        const type: EventType = state === 'touch' ? 'SNR_TOUCH' : 'SNR_NEAR';
        out.push({
          type,
          candleTime: c.time,
          price: c.close,
          zone: { id: z.id, kind: z.kind, low: z.low, high: z.high },
          status: 'TEST fixture — bukan sinyal trading',
          details: { distance: Number(distance.toFixed(4)), near_distance: dist },
        });
      }
    }
    ctx.state.zoneState = next;
    return out;
  },
};

const REGISTRY: Record<string, StrategyAdapter> = {
  [notConfiguredAdapter.key]: notConfiguredAdapter,
  [testZoneProximityAdapter.key]: testZoneProximityAdapter,
  [snrAdapter.key]: snrAdapter,
  [breakoutAdapter.key]: breakoutAdapter,
  [breakoutV03Adapter.key]: breakoutV03Adapter,
  [breakoutV04Adapter.key]: breakoutV04Adapter,
  [breakoutV05Adapter.key]: breakoutV05Adapter,
  [breakoutV06Adapter.key]: breakoutV06Adapter,
  [breakoutV07Adapter.key]: breakoutV07Adapter,
  [breakoutV08Adapter.key]: breakoutV08Adapter,
  ...Object.fromEntries(methodAdapters.map((a) => [a.key, a])),
  [volBreakAdapter.key]: volBreakAdapter,
  [bosH1Adapter.key]: bosH1Adapter,
  [snrSndAdapter.key]: snrSndAdapter,
  [customAdapter.key]: customAdapter,
  [snrSnd2Adapter.key]: snrSnd2Adapter,
  [nPatternAdapter.key]: nPatternAdapter,
  [rbrDbdAdapter.key]: rbrDbdAdapter,
  [snrBreakAdapter.key]: snrBreakAdapter,
  [obFvgAdapter.key]: obFvgAdapter,
};

export function getAdapter(key: string | null | undefined): StrategyAdapter {
  return (key && REGISTRY[key]) || notConfiguredAdapter;
}
export function listAdapters(): StrategyAdapter[] {
  return Object.values(REGISTRY);
}
