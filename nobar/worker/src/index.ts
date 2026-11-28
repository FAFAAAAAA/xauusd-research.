import {
  PIN_RE,
  ROOM_ID_RE,
  type CreateRoomResponse,
  type IceResponse,
  type JoinResponse,
} from '../../shared/protocol';
import { newRoomId } from './crypto';
import { Room } from './room';

export { Room };

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  ASSETS: Fetcher;
  /** Optional Cloudflare Realtime TURN key (wrangler secret). Without both, only STUN is offered. */
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
}

const STUN = { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] };
const TURN_TTL_SEC = 6 * 60 * 60;

/** Headers for HTML served by the Worker itself (the /w/:room route). Static files get the same set from _headers. */
const PAGE_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Permissions-Policy': 'display-capture=(self), screen-wake-lock=(self), fullscreen=(self), camera=(), microphone=(), geolocation=()',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/** Browsers always send Origin on POST and WebSocket; refuse calls made from other sites. */
function sameOrigin(req: Request, url: URL): boolean {
  const origin = req.headers.get('Origin');
  return origin === null || origin === url.origin;
}

async function readJson<T>(req: Request): Promise<T | null> {
  try {
    const text = await req.text();
    if (text.length > 4096) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function room(env: Env, id: string) {
  return env.ROOMS.get(env.ROOMS.idFromName(id));
}

async function createRoom(env: Env): Promise<Response> {
  for (let i = 0; i < 5; i++) {
    const roomId = newRoomId();
    const made = await room(env, roomId).create();
    if (made) return json({ roomId, ...made } satisfies CreateRoomResponse, 201);
  }
  return json({ error: 'could_not_allocate' }, 503);
}

async function iceServers(env: Env): Promise<IceResponse> {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return { iceServers: [STUN], turn: false };
  try {
    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: TURN_TTL_SEC }),
      },
    );
    if (!res.ok) throw new Error(`turn ${res.status}`);
    const body = (await res.json()) as { iceServers: IceResponse['iceServers'] | IceResponse['iceServers'][number] };
    const list = Array.isArray(body.iceServers) ? body.iceServers : [body.iceServers];
    // Port 53 URLs time out in browsers and only slow ICE gathering down.
    const cleaned = list
      .map((s) => ({ ...s, urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u)) }))
      .filter((s) => s.urls.length > 0);
    return { iceServers: [STUN, ...cleaned], turn: true };
  } catch (err) {
    console.error('TURN credential request failed', err);
    return { iceServers: [STUN], turn: false };
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path.startsWith('/api/') || path.startsWith('/ws/')) {
      if (!sameOrigin(req, url)) return json({ error: 'forbidden' }, 403);
    }

    if (path === '/api/rooms' && req.method === 'POST') return createRoom(env);

    let m = path.match(/^\/api\/rooms\/([^/]+)\/(join|ice)$/);
    if (m && req.method === 'POST') {
      const [, id, action] = m;
      if (!ROOM_ID_RE.test(id)) return json({ ok: false, reason: 'not_found' } satisfies JoinResponse, 404);
      if (action === 'join') {
        const body = await readJson<{ pin?: unknown }>(req);
        const pin = typeof body?.pin === 'string' ? body.pin : '';
        if (!PIN_RE.test(pin)) return json({ ok: false, reason: 'bad_request' } satisfies JoinResponse, 400);
        const result = await room(env, id).join(pin);
        const status = result.ok ? 200 : result.reason === 'not_found' ? 404 : result.reason === 'locked' ? 429 : 401;
        return json(result, status);
      }
      const body = await readJson<{ token?: unknown }>(req);
      const token = typeof body?.token === 'string' ? body.token : '';
      if (!(await room(env, id).roleFor(token))) return json({ error: 'unauthorized' }, 401);
      return json(await iceServers(env));
    }

    m = path.match(/^\/ws\/([^/]+)$/);
    if (m) {
      if (!ROOM_ID_RE.test(m[1])) return new Response('not found', { status: 404 });
      return room(env, m[1]).fetch(req);
    }

    m = path.match(/^\/w\/([^/]+)\/?$/);
    if (m && (req.method === 'GET' || req.method === 'HEAD')) {
      const page = await env.ASSETS.fetch(new Request(new URL('/watch', url), { method: req.method }));
      const res = new Response(page.body, page);
      for (const [k, v] of Object.entries(PAGE_HEADERS)) res.headers.set(k, v);
      res.headers.set('Cache-Control', 'no-cache');
      return res;
    }

    if (path.startsWith('/api/')) return json({ error: 'not_found' }, 404);
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
