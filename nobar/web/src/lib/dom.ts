import type { IceResponse } from '../../../shared/protocol';

export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
}

export function show(el: HTMLElement, on: boolean): void {
  el.hidden = !on;
}

export async function postJson<T>(path: string, body: unknown): Promise<{ status: number; data: T | null }> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    let data: T | null = null;
    try {
      data = (await res.json()) as T;
    } catch {
      /* empty body */
    }
    return { status: res.status, data };
  } catch {
    return { status: 0, data: null };
  }
}

export const FALLBACK_ICE: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

export async function fetchIce(roomId: string, token: string): Promise<{ servers: RTCIceServer[]; turn: boolean }> {
  const { data } = await postJson<IceResponse>(`/api/rooms/${roomId}/ice`, { token });
  if (!data?.iceServers?.length) return { servers: FALLBACK_ICE, turn: false };
  return { servers: data.iceServers as RTCIceServer[], turn: data.turn };
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older Safari or no permission: select a temporary textarea.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

/** Short visible confirmation on a button, then restore its label. */
export function flashLabel(btn: HTMLButtonElement, text: string, ms = 1800): void {
  const original = btn.dataset.label ?? btn.textContent ?? '';
  btn.dataset.label = original;
  btn.textContent = text;
  window.setTimeout(() => {
    btn.textContent = original;
  }, ms);
}

export const randomId = (): string => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const isIOS = (): boolean =>
  /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** In-app browsers (KakaoTalk, Instagram, Facebook, LINE) handle media worse than Safari or Chrome. */
export const inAppBrowser = (): string | null => {
  const ua = navigator.userAgent;
  if (/KAKAOTALK/i.test(ua)) return 'KakaoTalk';
  if (/FBAN|FBAV/i.test(ua)) return 'Facebook';
  if (/Instagram/i.test(ua)) return 'Instagram';
  if (/\bLine\//i.test(ua)) return 'LINE';
  return null;
};

export function stamp(): string {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
}
