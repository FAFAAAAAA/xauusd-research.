import { describe, expect, it } from 'vitest';
import { orderVideoCodecs, scaleFor, tuneOpus } from '../../web/src/lib/sdp';
import { summarize, verdict } from '../../web/src/lib/stats';

describe('orderVideoCodecs', () => {
  it('puts H.264 packetization-mode=1 first, then VP8, keeps every codec', () => {
    const input = [
      { mimeType: 'video/VP9' },
      { mimeType: 'video/rtx' },
      { mimeType: 'video/VP8' },
      { mimeType: 'video/H264', sdpFmtpLine: 'packetization-mode=0;profile-level-id=42e01f' },
      { mimeType: 'video/AV1' },
      { mimeType: 'video/H264', sdpFmtpLine: 'packetization-mode=1;profile-level-id=42e01f' },
    ];
    const out = orderVideoCodecs(input).map((c) => `${c.mimeType}${c.sdpFmtpLine?.includes('mode=1') ? '/1' : ''}`);
    expect(out).toEqual(['video/H264/1', 'video/H264', 'video/VP8', 'video/VP9', 'video/AV1', 'video/rtx']);
    expect(out).toHaveLength(input.length);
  });
});

describe('tuneOpus', () => {
  const sdp = [
    'v=0',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111 63',
    'a=rtpmap:111 opus/48000/2',
    'a=rtcp-fb:111 transport-cc',
    'a=fmtp:111 minptime=10;useinbandfec=1',
    'a=rtpmap:63 red/48000/2',
    '',
  ].join('\r\n');

  it('adds stereo and bitrate, keeps existing params and line endings', () => {
    const out = tuneOpus(sdp, 128000);
    expect(out).toContain('a=fmtp:111 minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1;maxaveragebitrate=128000;usedtx=0\r\n');
    expect(out.split('\r\n')).toHaveLength(sdp.split('\r\n').length);
  });

  it('adds an fmtp line when missing', () => {
    const noFmtp = sdp.replace('a=fmtp:111 minptime=10;useinbandfec=1\r\n', '');
    const out = tuneOpus(noFmtp);
    expect(out).toMatch(/a=rtpmap:111 opus\/48000\/2\r\na=fmtp:111 stereo=1;/);
  });

  it('leaves SDP without Opus untouched', () => {
    expect(tuneOpus('v=0\r\nm=video 9 x 96\r\n')).toBe('v=0\r\nm=video 9 x 96\r\n');
  });
});

describe('scaleFor', () => {
  it('never upscales', () => {
    expect(scaleFor(720, 1080)).toBe(1);
    expect(scaleFor(undefined, 720)).toBe(1);
  });
  it('downscales to the target height', () => {
    expect(scaleFor(1080, 720)).toBe(1.5);
    expect(scaleFor(1440, 720)).toBe(2);
  });
});

describe('summarize (inbound)', () => {
  const base = (bytes: number, frames: number, lost: number, received: number, ts: number) => [
    { type: 'transport', id: 'T', timestamp: ts, selectedCandidatePairId: 'CP' },
    { type: 'candidate-pair', id: 'CP', timestamp: ts, state: 'succeeded', currentRoundTripTime: 0.092, localCandidateId: 'L', remoteCandidateId: 'R' },
    { type: 'local-candidate', id: 'L', timestamp: ts, candidateType: 'srflx', address: '2001:db8::1' },
    { type: 'remote-candidate', id: 'R', timestamp: ts, candidateType: 'srflx' },
    { type: 'codec', id: 'C', timestamp: ts, mimeType: 'video/H264' },
    { type: 'inbound-rtp', id: 'V', timestamp: ts, kind: 'video', codecId: 'C', bytesReceived: bytes, framesDecoded: frames, packetsLost: lost, packetsReceived: received, frameWidth: 1280, frameHeight: 720, jitter: 0.012 },
  ];

  it('computes rates from two snapshots and the path', () => {
    const first = summarize(base(0, 0, 0, 0, 1000), 'in', null);
    const { summary } = summarize(base(312_500, 30, 2, 198, 2000), 'in', first.snap);
    expect(summary).toMatchObject({ path: 'langsung', ipv6: true, rttMs: 92, kbps: 2500, fps: 30, lossPct: 1, width: 1280, height: 720, codec: 'H264', jitterMs: 12 });
    expect(verdict(summary)).toBe('Bagus');
  });

  it('reports relay and a weak verdict on heavy loss', () => {
    const stats = base(100_000, 10, 20, 80, 2000);
    (stats[2] as Record<string, unknown>).candidateType = 'relay';
    const first = summarize(base(0, 0, 0, 0, 1000), 'in', null);
    const { summary } = summarize(stats, 'in', first.snap);
    expect(summary.path).toBe('relay');
    expect(verdict(summary)).toBe('Lemah');
  });
});
