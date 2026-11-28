/** Pure helpers for SDP and codec ordering, kept free of DOM so they can be unit tested. */

export interface CodecLike {
  mimeType: string;
  sdpFmtpLine?: string;
  clockRate?: number;
  channels?: number;
}

/**
 * Order video codecs: H.264 first (hardware decode on iPhone, lowest encode CPU in tests),
 * then VP8, then the rest. Within H.264, packetization-mode=1 first, since that is what iOS expects.
 * Every codec is kept (rtx, red, ulpfec too), only reordered.
 */
export function orderVideoCodecs<T extends CodecLike>(codecs: readonly T[]): T[] {
  const rank = (c: T): number => {
    const mime = c.mimeType.toLowerCase();
    const fmtp = c.sdpFmtpLine ?? '';
    if (mime === 'video/h264') return fmtp.includes('packetization-mode=1') ? 0 : 1;
    if (mime === 'video/vp8') return 2;
    if (mime === 'video/rtx' || mime === 'video/red' || mime === 'video/ulpfec' || mime === 'video/flexfec-03') return 9;
    return 5;
  };
  return codecs
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i)
    .map((x) => x.c);
}

/**
 * Ask for Opus stereo at a music bitrate, without DTX. Chrome only sends stereo when the
 * remote description carries stereo=1, so the host applies this to the viewer's answer.
 */
export function tuneOpus(sdp: string, maxAverageBitrate = 128_000): string {
  const m = sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/i);
  if (!m) return sdp;
  const pt = m[1];
  const want: Record<string, string> = {
    stereo: '1',
    'sprop-stereo': '1',
    maxaveragebitrate: String(maxAverageBitrate),
    usedtx: '0',
    useinbandfec: '1',
  };
  const fmtpRe = new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`);
  if (!fmtpRe.test(sdp)) {
    const line = `a=fmtp:${pt} ` + Object.entries(want).map(([k, v]) => `${k}=${v}`).join(';');
    return sdp.replace(new RegExp(`(a=rtpmap:${pt} opus/48000/2[^\\r\\n]*)`, 'i'), `$1\r\n${line}`);
  }
  return sdp.replace(fmtpRe, (_all, params: string) => {
    const map = new Map<string, string>();
    for (const part of params.split(';')) {
      const [k, ...rest] = part.trim().split('=');
      if (k) map.set(k, rest.join('='));
    }
    for (const [k, v] of Object.entries(want)) map.set(k, v);
    return `a=fmtp:${pt} ` + [...map].map(([k, v]) => `${k}=${v}`).join(';');
  });
}

/** Downscale factor so the encoded height does not exceed the target. Never upscales. */
export function scaleFor(sourceHeight: number | undefined, targetHeight: number): number {
  if (!sourceHeight || sourceHeight <= targetHeight) return 1;
  return Math.round((sourceHeight / targetHeight) * 100) / 100;
}
