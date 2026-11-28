/**
 * Turns RTCStatsReport into a few numbers people can read. Every field is optional because
 * Safari and Chrome expose different subsets: show what exists, never guess.
 */

export type Path = 'langsung' | 'relay';
export type Verdict = 'Bagus' | 'Cukup' | 'Lemah';

export interface Summary {
  path?: Path;
  ipv6?: boolean;
  rttMs?: number;
  kbps?: number;
  fps?: number;
  width?: number;
  height?: number;
  lossPct?: number;
  jitterMs?: number;
  codec?: string;
  /** Host only: why Chrome is lowering quality ("bandwidth", "cpu"). */
  limit?: string;
  availableKbps?: number;
  freezes?: number;
}

interface Snapshot {
  ts: number;
  bytes: number;
  frames: number;
  lost: number;
  packets: number;
}

type Stat = Record<string, unknown> & { type: string; id: string; timestamp: number };

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export function summarize(stats: Iterable<Stat>, dir: 'in' | 'out', prev: Snapshot | null): { summary: Summary; snap: Snapshot | null } {
  const all = [...stats];
  const byId = new Map(all.map((s) => [s.id, s]));
  const summary: Summary = {};

  // Selected candidate pair: transport.selectedCandidatePairId where available, else the nominated succeeded pair.
  const transport = all.find((s) => s.type === 'transport');
  let pair = transport ? byId.get(str(transport.selectedCandidatePairId) ?? '') : undefined;
  pair ??= all.find((s) => s.type === 'candidate-pair' && s.state === 'succeeded' && (s.nominated === true || s.selected === true));
  if (pair) {
    const rtt = num(pair.currentRoundTripTime);
    if (rtt !== undefined) summary.rttMs = Math.round(rtt * 1000);
    const avail = num(pair.availableOutgoingBitrate);
    if (avail !== undefined && dir === 'out') summary.availableKbps = Math.round(avail / 1000);
    const local = byId.get(str(pair.localCandidateId) ?? '');
    const remote = byId.get(str(pair.remoteCandidateId) ?? '');
    if (local || remote) {
      summary.path = local?.candidateType === 'relay' || remote?.candidateType === 'relay' ? 'relay' : 'langsung';
      const addr = str(local?.address) ?? str(local?.ip) ?? '';
      if (addr) summary.ipv6 = addr.includes(':');
    }
  }

  const rtpType = dir === 'in' ? 'inbound-rtp' : 'outbound-rtp';
  const rtp = all.find((s) => s.type === rtpType && (s.kind ?? s.mediaType) === 'video');
  if (!rtp) return { summary, snap: null };

  summary.width = num(rtp.frameWidth);
  summary.height = num(rtp.frameHeight);
  summary.freezes = num(rtp.freezeCount);
  summary.limit = dir === 'out' ? str(rtp.qualityLimitationReason) : undefined;
  const codec = byId.get(str(rtp.codecId) ?? '');
  if (codec) summary.codec = str(codec.mimeType)?.replace(/^video\//i, '');

  const bytes = num(dir === 'in' ? rtp.bytesReceived : rtp.bytesSent) ?? 0;
  const frames = num(dir === 'in' ? rtp.framesDecoded : rtp.framesEncoded) ?? 0;
  let lost = 0;
  let packets = 0;
  if (dir === 'in') {
    lost = num(rtp.packetsLost) ?? 0;
    packets = num(rtp.packetsReceived) ?? 0;
    const jitter = num(rtp.jitter);
    if (jitter !== undefined) summary.jitterMs = Math.round(jitter * 1000);
  } else {
    const remoteIn = all.find((s) => s.type === 'remote-inbound-rtp' && (s.kind ?? s.mediaType) === 'video');
    lost = num(remoteIn?.packetsLost) ?? 0;
    packets = num(rtp.packetsSent) ?? 0;
    if (summary.rttMs === undefined) {
      const rtt = num(remoteIn?.roundTripTime);
      if (rtt !== undefined) summary.rttMs = Math.round(rtt * 1000);
    }
    const jitter = num(remoteIn?.jitter);
    if (jitter !== undefined) summary.jitterMs = Math.round(jitter * 1000);
  }

  const snap: Snapshot = { ts: rtp.timestamp, bytes, frames, lost, packets };
  if (prev && snap.ts > prev.ts) {
    const sec = (snap.ts - prev.ts) / 1000;
    summary.kbps = Math.max(0, Math.round(((snap.bytes - prev.bytes) * 8) / 1000 / sec));
    summary.fps = Math.max(0, Math.round((snap.frames - prev.frames) / sec));
    const dLost = Math.max(0, snap.lost - prev.lost);
    const dPackets = Math.max(0, snap.packets - prev.packets);
    const base = dir === 'in' ? dLost + dPackets : dPackets;
    if (base > 0) summary.lossPct = Math.round((dLost / base) * 1000) / 10;
  }
  return { summary, snap };
}

/** One word for people who do not read numbers. Thresholds are starting points, to be tuned from real sessions. */
export function verdict(s: Summary): Verdict | undefined {
  if (s.kbps === undefined && s.rttMs === undefined) return undefined;
  const loss = s.lossPct ?? 0;
  const rtt = s.rttMs ?? 0;
  const fps = s.fps ?? 30;
  if (loss > 5 || rtt > 400 || fps < 12) return 'Lemah';
  if (loss > 1.5 || rtt > 250 || fps < 22) return 'Cukup';
  return 'Bagus';
}

export class StatsReader {
  private prev: Snapshot | null = null;
  constructor(
    private readonly pc: RTCPeerConnection,
    private readonly dir: 'in' | 'out',
  ) {}

  async read(): Promise<Summary> {
    const report = await this.pc.getStats();
    const { summary, snap } = summarize(report.values() as Iterable<Stat>, this.dir, this.prev);
    if (snap) this.prev = snap;
    return summary;
  }
}

export function describePath(s: Summary): string | undefined {
  if (!s.path) return undefined;
  const ip = s.ipv6 === undefined ? '' : s.ipv6 ? ', IPv6' : ', IPv4';
  return s.path === 'relay' ? `lewat relay TURN${ip}` : `langsung P2P${ip}`;
}

/** Rows for the stats panel: [label, value]. Only fields that exist. */
export function statRows(s: Summary): [string, string][] {
  const rows: [string, string][] = [];
  const path = describePath(s);
  if (path) rows.push(['Jalur', path]);
  if (s.width && s.height) rows.push(['Resolusi', `${s.width}×${s.height}`]);
  if (s.fps !== undefined) rows.push(['FPS', String(s.fps)]);
  if (s.kbps !== undefined) rows.push(['Bitrate', s.kbps >= 1000 ? `${(s.kbps / 1000).toFixed(1)} Mbps` : `${s.kbps} kbps`]);
  if (s.rttMs !== undefined) rows.push(['RTT', `${s.rttMs} ms`]);
  if (s.lossPct !== undefined) rows.push(['Paket hilang', `${s.lossPct}%`]);
  if (s.jitterMs !== undefined) rows.push(['Jitter', `${s.jitterMs} ms`]);
  if (s.codec) rows.push(['Codec', s.codec]);
  if (s.limit && s.limit !== 'none') rows.push(['Dibatasi oleh', s.limit === 'bandwidth' ? 'jaringan' : s.limit === 'cpu' ? 'CPU laptop' : s.limit]);
  if (s.availableKbps !== undefined) rows.push(['Perkiraan kapasitas', `${(s.availableKbps / 1000).toFixed(1)} Mbps`]);
  if (s.freezes !== undefined) rows.push(['Gambar beku', `${s.freezes}×`]);
  return rows;
}
