import { FATAL_CLOSE_CODES, PING, type ClientMsg, type ServerMsg, type Signal } from '../../../shared/protocol';

export type SignalingState = 'connecting' | 'open' | 'waiting';

/**
 * WebSocket to the room with automatic reconnect (1, 2, 4 ... 30 s with jitter).
 * Codes in FATAL_CLOSE_CODES stop the loop and go to onFatal.
 */
export class Signaling {
  onMessage: (m: ServerMsg) => void = () => {};
  onState: (s: SignalingState) => void = () => {};
  onFatal: (code: number) => void = () => {};

  private ws: WebSocket | null = null;
  private attempt = 0;
  private retryTimer: number | undefined;
  private pingTimer: number | undefined;
  private stopped = false;

  constructor(
    private readonly roomId: string,
    private readonly token: string,
  ) {
    window.addEventListener('online', this.kick);
    document.addEventListener('visibilitychange', this.onVisible);
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(): void {
    if (this.stopped) return;
    window.clearTimeout(this.retryTimer);
    this.onState('connecting');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws/${this.roomId}?token=${encodeURIComponent(this.token)}`);
    this.ws = ws;

    ws.onopen = () => {
      this.attempt = 0;
      this.onState('open');
      window.clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(PING);
      }, 25_000);
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      try {
        const msg = JSON.parse(ev.data) as ServerMsg;
        if (msg.t !== 'pong') this.onMessage(msg);
      } catch {
        /* ignore malformed */
      }
    };
    ws.onclose = (ev) => {
      window.clearInterval(this.pingTimer);
      if (this.ws !== ws) return;
      this.ws = null;
      if (FATAL_CLOSE_CODES.includes(ev.code)) {
        this.stopped = true;
        this.onFatal(ev.code);
        return;
      }
      this.scheduleRetry();
    };
  }

  signal(data: Signal): void {
    this.send({ t: 'signal', data });
  }

  send(msg: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.stopped = true;
    window.clearTimeout(this.retryTimer);
    window.clearInterval(this.pingTimer);
    window.removeEventListener('online', this.kick);
    document.removeEventListener('visibilitychange', this.onVisible);
    this.ws?.close(1000);
    this.ws = null;
  }

  private scheduleRetry(): void {
    if (this.stopped) return;
    const base = Math.min(30_000, 1000 * 2 ** this.attempt);
    const delay = base / 2 + Math.random() * (base / 2);
    this.attempt++;
    this.onState('waiting');
    this.retryTimer = window.setTimeout(() => this.connect(), delay);
  }

  /** Network came back or the page became visible: retry now instead of waiting out the backoff. */
  private kick = (): void => {
    if (this.stopped || this.ws) return;
    this.attempt = 0;
    this.connect();
  };

  private onVisible = (): void => {
    if (document.visibilityState === 'visible') this.kick();
  };
}
