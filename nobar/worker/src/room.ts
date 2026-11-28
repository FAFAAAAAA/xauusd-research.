import { DurableObject } from 'cloudflare:workers';
import {
  CLOSE,
  MAX_MESSAGE_BYTES,
  PIN_LOCK_MS,
  PIN_MAX_FAILS,
  PING,
  PONG,
  ROOM_IDLE_TTL_MS,
  type ClientMsg,
  type JoinResponse,
  type Role,
  type ServerMsg,
} from '../../shared/protocol';
import { newPin, newToken, sameHash, sha256 } from './crypto';
import type { Env } from './index';

interface Meta {
  salt: string;
  pinHash: string;
  hostTokenHash: string;
  /** A few viewer tokens, so the viewer can switch phone/browser without locking the old one out mid-film. */
  viewerTokenHashes: string[];
  fails: number;
  lockedUntil: number;
  lastActive: number;
}

interface Attachment {
  role: Role;
}

const MAX_VIEWER_TOKENS = 4;

/** One Durable Object per room. Holds the PIN check and relays signaling between exactly one host and one viewer. */
export class Room extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Answer keepalive pings without waking the object (no duration billed).
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
  }

  private meta(): Promise<Meta | undefined> {
    return this.ctx.storage.get<Meta>('meta');
  }

  private async touch(meta: Meta): Promise<void> {
    meta.lastActive = Date.now();
    await this.ctx.storage.put('meta', meta);
    await this.ctx.storage.setAlarm(meta.lastActive + ROOM_IDLE_TTL_MS);
  }

  /** RPC: initialise a fresh room. Returns null when the id is already taken. */
  async create(): Promise<{ pin: string; token: string } | null> {
    if (await this.meta()) return null;
    const pin = newPin();
    const token = newToken();
    const salt = newToken();
    const meta: Meta = {
      salt,
      pinHash: await sha256(salt + pin),
      hostTokenHash: await sha256(token),
      viewerTokenHashes: [],
      fails: 0,
      lockedUntil: 0,
      lastActive: Date.now(),
    };
    await this.touch(meta);
    return { pin, token };
  }

  /** RPC: check a PIN and hand out a viewer token. Locks the room for a while after repeated wrong PINs. */
  async join(pin: string): Promise<JoinResponse> {
    const meta = await this.meta();
    if (!meta) return { ok: false, reason: 'not_found' };
    const now = Date.now();
    if (meta.lockedUntil > now) {
      return { ok: false, reason: 'locked', retryAfterSec: Math.ceil((meta.lockedUntil - now) / 1000) };
    }
    if (meta.lockedUntil && meta.lockedUntil <= now) {
      meta.lockedUntil = 0;
      meta.fails = 0;
    }
    if (!sameHash(await sha256(meta.salt + pin), meta.pinHash)) {
      meta.fails += 1;
      if (meta.fails >= PIN_MAX_FAILS) {
        meta.lockedUntil = now + PIN_LOCK_MS;
        await this.ctx.storage.put('meta', meta);
        return { ok: false, reason: 'locked', retryAfterSec: Math.ceil(PIN_LOCK_MS / 1000) };
      }
      await this.ctx.storage.put('meta', meta);
      return { ok: false, reason: 'wrong_pin', left: PIN_MAX_FAILS - meta.fails };
    }
    const token = newToken();
    meta.fails = 0;
    meta.viewerTokenHashes = [...meta.viewerTokenHashes, await sha256(token)].slice(-MAX_VIEWER_TOKENS);
    await this.touch(meta);
    return { ok: true, token };
  }

  /** RPC: which role does this token belong to? */
  async roleFor(token: string): Promise<Role | null> {
    const meta = await this.meta();
    if (!meta || !token) return null;
    const h = await sha256(token);
    if (sameHash(h, meta.hostTokenHash)) return 'host';
    if (meta.viewerTokenHashes.some((v) => sameHash(h, v))) return 'viewer';
    return null;
  }

  /** WebSocket upgrade, forwarded by the Worker. */
  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    const token = new URL(req.url).searchParams.get('token') ?? '';
    const { 0: client, 1: server } = new WebSocketPair();

    const meta = await this.meta();
    const role = meta ? await this.roleFor(token) : null;
    if (!meta || !role) {
      // Accept, explain, close: a browser cannot read the HTTP status of a refused upgrade.
      server.accept();
      const code = meta ? 'unauthorized' : 'not_found';
      server.send(JSON.stringify({ t: 'error', code } satisfies ServerMsg));
      server.close(meta ? CLOSE.unauthorized : CLOSE.notFound, code);
      return new Response(null, { status: 101, webSocket: client });
    }

    // One socket per role: a newer tab replaces the older one.
    for (const old of this.ctx.getWebSockets(role)) {
      try {
        old.close(CLOSE.replaced, 'replaced');
      } catch {
        /* already closing */
      }
    }

    this.ctx.acceptWebSocket(server, [role]);
    server.serializeAttachment({ role } satisfies Attachment);
    const other: Role = role === 'host' ? 'viewer' : 'host';
    this.send(server, { t: 'welcome', role, peer: this.openSockets(other).length > 0 });
    this.broadcast(other, { t: 'peer', role, present: true });
    await this.touch(meta);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_BYTES) return;
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att) return;
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw) as ClientMsg;
    } catch {
      return;
    }
    if (msg.t === 'signal' && msg.data && typeof msg.data === 'object') {
      const other: Role = att.role === 'host' ? 'viewer' : 'host';
      this.broadcast(other, { t: 'signal', data: msg.data });
    } else if (msg.t === 'end' && att.role === 'host') {
      await this.endRoom();
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    this.onGone(ws);
    try {
      ws.close(code === 1005 ? 1000 : code, reason);
    } catch {
      /* already closed */
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.onGone(ws);
  }

  async alarm(): Promise<void> {
    const meta = await this.meta();
    if (!meta) return;
    if (this.ctx.getWebSockets().length > 0) {
      await this.ctx.storage.setAlarm(Date.now() + ROOM_IDLE_TTL_MS);
      return;
    }
    if (Date.now() - meta.lastActive >= ROOM_IDLE_TTL_MS) {
      await this.ctx.storage.deleteAll();
    } else {
      await this.ctx.storage.setAlarm(meta.lastActive + ROOM_IDLE_TTL_MS);
    }
  }

  private onGone(ws: WebSocket): void {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att) return;
    const stillThere = this.openSockets(att.role).some((s) => s !== ws);
    if (!stillThere) {
      const other: Role = att.role === 'host' ? 'viewer' : 'host';
      this.broadcast(other, { t: 'peer', role: att.role, present: false });
    }
  }

  private async endRoom(): Promise<void> {
    for (const s of this.ctx.getWebSockets()) {
      this.send(s, { t: 'ended' });
      try {
        s.close(CLOSE.ended, 'ended');
      } catch {
        /* ignore */
      }
    }
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  private openSockets(role: Role): WebSocket[] {
    return this.ctx.getWebSockets(role).filter((s) => s.readyState === WebSocket.OPEN);
  }

  private broadcast(role: Role, msg: ServerMsg): void {
    for (const s of this.openSockets(role)) this.send(s, msg);
  }

  private send(ws: WebSocket, msg: ServerMsg): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket went away; close handler cleans up */
    }
  }
}
