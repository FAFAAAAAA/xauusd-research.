import { CLOSE, PIN_RE, ROOM_ID_RE, type JoinResponse, type ServerMsg, type Signal } from '../../shared/protocol';
import { $, copyText, fetchIce, FALLBACK_ICE, flashLabel, inAppBrowser, isIOS, postJson, show, stamp } from './lib/dom';
import { Signaling, type SignalingState } from './lib/signaling';
import { StatsReader, statRows, verdict } from './lib/stats';

const el = {
  roomLabel: $('roomLabel'),
  inApp: $('inApp'),
  gate: $('gate'),
  pinForm: $<HTMLFormElement>('pinForm'),
  pin: $<HTMLInputElement>('pin'),
  pinError: $('pinError'),
  pinBtn: $<HTMLButtonElement>('pinBtn'),
  gone: $('gone'),
  goneTitle: $('goneTitle'),
  goneText: $('goneText'),
  player: $('player'),
  stage: $('stage'),
  video: $<HTMLVideoElement>('video'),
  cover: $('cover'),
  coverText: $('coverText'),
  startWrap: $('startWrap'),
  startBtn: $<HTMLButtonElement>('startBtn'),
  startHint: $('startHint'),
  pill: $('pill'),
  statsFloat: $('statsFloat'),
  viewerStats: $('viewerStats'),
  dock: $('dock'),
  statsBtn: $<HTMLButtonElement>('statsBtn'),
  soundBtn: $<HTMLButtonElement>('soundBtn'),
  fsBtn: $<HTMLButtonElement>('fsBtn'),
  tips: $('tips'),
  logBox: $<HTMLDetailsElement>('logBox'),
  sessionField: $('sessionField'),
  sessionType: $<HTMLSelectElement>('sessionType'),
  log: $('log'),
  copyLogBtn: $<HTMLButtonElement>('copyLogBtn'),
};

const roomId = (location.pathname.match(/^\/w\/([^/]+)/)?.[1] ?? new URLSearchParams(location.search).get('r') ?? '').toUpperCase();
const tokenKey = `nobar.v.${roomId}`;
const ios = isIOS();

let sig: Signaling | null = null;
let ice: RTCIceServer[] = FALLBACK_ICE;
let pc: RTCPeerConnection | null = null;
let pcId: string | null = null;
let pendingIce: RTCIceCandidateInit[] = [];
let hostPresent = false;
let hostSharing: boolean | null = null;
let hostAudio: boolean | null = null;
let sigState: SignalingState = 'connecting';
/** The viewer tapped "Mulai nonton" at least once (needed for sound on phones). */
let started = false;
/** The viewer chose to watch without the film's sound (e.g. while on a WhatsApp call). */
let filmMuted = false;
let badSince = 0;
let lastHello = 0;
let idleTimer: number | undefined;
let statsTimer: number | undefined;
let stats: StatsReader | null = null;
let wakeLock: WakeLockSentinel | null = null;
let expectPlaying = false;

// ---------- log (for the WhatsApp audio test) ----------

const logLines: string[] = [];
function log(text: string): void {
  const line = `${stamp()}  ${text}`;
  logLines.push(line);
  if (logLines.length > 300) logLines.shift();
  const li = document.createElement('li');
  li.textContent = line;
  el.log.append(li);
  while (el.log.childElementCount > 300) el.log.firstElementChild?.remove();
}

// ---------- token ----------

function getToken(): string | null {
  try {
    return localStorage.getItem(tokenKey);
  } catch {
    return null;
  }
}
function setToken(t: string | null): void {
  try {
    if (t) localStorage.setItem(tokenKey, t);
    else localStorage.removeItem(tokenKey);
  } catch {
    /* private mode */
  }
}

// ---------- screens ----------

function showGone(title: string, text: string): void {
  [el.gate, el.player, el.tips].forEach((s) => show(s, false));
  el.goneTitle.textContent = title;
  el.goneText.textContent = text;
  show(el.gone, true);
  exitCinema();
}

function showGate(message?: string): void {
  [el.player, el.tips, el.logBox, el.gone].forEach((s) => show(s, false));
  show(el.gate, true);
  if (message) {
    el.pinError.textContent = message;
    show(el.pinError, true);
  }
  el.pin.focus();
}

// ---------- PIN ----------

async function submitPin(): Promise<void> {
  const pin = el.pin.value.replace(/\D/g, '');
  el.pin.value = pin;
  if (!PIN_RE.test(pin)) {
    el.pin.setAttribute('aria-invalid', 'true');
    el.pinError.textContent = 'PIN terdiri dari 6 angka.';
    show(el.pinError, true);
    return;
  }
  el.pinBtn.disabled = true;
  el.pinBtn.textContent = 'Memeriksa…';
  const { status, data } = await postJson<JoinResponse>(`/api/rooms/${roomId}/join`, { pin });
  el.pinBtn.disabled = false;
  el.pinBtn.textContent = 'Masuk';
  if (data?.ok) {
    setToken(data.token);
    show(el.pinError, false);
    el.pin.removeAttribute('aria-invalid');
    startWatching(data.token);
    return;
  }
  el.pin.setAttribute('aria-invalid', 'true');
  let msg = 'Tidak bisa memeriksa PIN. Coba lagi.';
  if (status === 0) msg = 'Tidak ada koneksi internet. Periksa jaringan lalu coba lagi.';
  else if (data && !data.ok) {
    if (data.reason === 'wrong_pin') msg = `PIN salah. Sisa ${data.left} kali percobaan.`;
    else if (data.reason === 'locked') msg = `Terlalu banyak PIN salah. Coba lagi dalam ${Math.ceil(data.retryAfterSec / 60)} menit.`;
    else if (data.reason === 'not_found') {
      showGone('Room tidak ditemukan', 'Room ini sudah diakhiri atau kedaluwarsa. Minta tautan baru ke host.');
      return;
    }
  }
  el.pinError.textContent = msg;
  show(el.pinError, true);
  el.pin.select();
}

// ---------- watching ----------

function startWatching(token: string): void {
  show(el.gate, false);
  [el.player, el.tips, el.logBox].forEach((s) => show(s, true));
  render();
  sig?.close();
  sig = new Signaling(roomId, token);
  sig.onMessage = onServer;
  sig.onState = (s) => {
    sigState = s;
    log(`server: ${s}`);
    render();
  };
  sig.onFatal = (code) => {
    log(`server menutup koneksi (${code})`);
    closePc();
    if (code === CLOSE.unauthorized) {
      setToken(null);
      showGate('Akses sudah tidak berlaku. Masukkan PIN lagi.');
    } else if (code === CLOSE.replaced) {
      showGone('Dibuka di tempat lain', 'Room ini sedang ditonton dari tab atau HP lain. Tutup tab ini.');
    } else {
      setToken(null);
      showGone('Room sudah berakhir', 'Host mengakhiri room ini, atau room sudah kedaluwarsa.');
    }
  };
  sig.connect();
  void fetchIce(roomId, token).then((r) => {
    ice = r.servers;
    log(r.turn ? 'relay TURN tersedia' : 'hanya STUN (tanpa relay TURN)');
  });
  window.setInterval(watchdog, 4000);
}

function onServer(m: ServerMsg): void {
  if (m.t === 'welcome') {
    hostPresent = m.peer;
    log(`masuk room, host ${m.peer ? 'ada' : 'belum ada'}`);
    if (m.peer) sendHello(true);
  } else if (m.t === 'peer' && m.role === 'host') {
    hostPresent = m.present;
    log(`host ${m.present ? 'kembali' : 'terputus dari server'}`);
    if (m.present) sendHello(true);
  } else if (m.t === 'signal') {
    void onSignal(m.data);
  }
  render();
}

function sendHello(force = false): void {
  if (!sig?.isOpen) return;
  if (!force && Date.now() - lastHello < 8000) return;
  lastHello = Date.now();
  sig.signal({ k: 'hello', pcId, connected: pc?.connectionState === 'connected', ios });
}

async function onSignal(s: Signal): Promise<void> {
  if (s.k === 'status') {
    hostSharing = s.sharing;
    hostAudio = s.audio;
    log(s.sharing ? `host berbagi tab${s.audio ? ' dengan suara' : ' tanpa suara'}` : 'host belum atau berhenti berbagi tab');
    if (!s.sharing) closePc();
    render();
    return;
  }
  if (s.k === 'offer') {
    hostSharing = true;
    if (s.pcId !== pcId) newPc(s.pcId);
    const conn = pc;
    if (!conn) return;
    try {
      await conn.setRemoteDescription({ type: 'offer', sdp: s.sdp });
      for (const c of pendingIce.splice(0)) await conn.addIceCandidate(c).catch(() => {});
      const answer = await conn.createAnswer();
      await conn.setLocalDescription(answer);
      sig?.signal({ k: 'answer', pcId: s.pcId, sdp: conn.localDescription?.sdp ?? answer.sdp ?? '' });
    } catch (err) {
      log(`gagal memproses offer: ${(err as Error).message}`);
    }
    return;
  }
  if (s.k === 'ice') {
    if (!pc || s.pcId !== pcId) return;
    if (!pc.remoteDescription) pendingIce.push(s.cand);
    else await pc.addIceCandidate(s.cand).catch(() => {});
  }
}

function newPc(id: string): void {
  closePc(false);
  const conn = new RTCPeerConnection({ iceServers: ice, bundlePolicy: 'max-bundle' });
  pc = conn;
  pcId = id;
  badSince = 0;
  log('koneksi baru dari host');

  conn.ontrack = (e) => {
    // A short playout buffer smooths jitter on long routes (Chrome/Android; Safari does not support it).
    const recv = e.receiver as RTCRtpReceiver & { jitterBufferTarget?: number | null };
    if (!ios && 'jitterBufferTarget' in recv) {
      try {
        recv.jitterBufferTarget = 300;
      } catch {
        /* ignore */
      }
    }
    e.track.onmute = () => log(`track ${e.track.kind}: tidak ada data`);
    e.track.onunmute = () => log(`track ${e.track.kind}: data masuk lagi`);
    const ms = e.streams[0] ?? new MediaStream([e.track]);
    if (el.video.srcObject !== ms) {
      el.video.srcObject = ms; // same <video> element across reconnects (iOS keeps the unlock)
      log(`stream terpasang (${ms.getTracks().map((t) => t.kind).join('+')})`);
      void play('stream baru');
    }
  };
  conn.onicecandidate = (e) => {
    if (e.candidate && pcId === id) sig?.signal({ k: 'ice', pcId: id, cand: e.candidate.toJSON() as never });
  };
  conn.onconnectionstatechange = () => {
    if (pc !== conn) return;
    log(`koneksi video: ${conn.connectionState}`);
    if (conn.connectionState === 'connected') {
      badSince = 0;
      if (!el.statsFloat.hidden) startStats();
    } else if (!badSince) {
      badSince = Date.now();
    }
    render();
  };
}

function closePc(clearVideo = true): void {
  window.clearInterval(statsTimer);
  stats = null;
  pc?.close();
  pc = null;
  pcId = null;
  pendingIce = [];
  if (clearVideo) {
    el.video.srcObject = null;
    expectPlaying = false;
  }
}

/** Recovery loop: if the video link is down for a while, ask the host for a new offer. */
function watchdog(): void {
  if (!sig?.isOpen || !hostPresent || hostSharing === false) return;
  const state = pc?.connectionState;
  if (!pc || state === 'closed') {
    sendHello();
    return;
  }
  if (state === 'connected') return;
  if (!badSince) badSince = Date.now();
  const bad = Date.now() - badSince;
  if ((state === 'failed' || state === 'disconnected') && bad > 8000) sendHello();
  else if ((state === 'new' || state === 'connecting') && bad > 20000) sendHello();
  render();
}

// ---------- playback ----------

async function play(reason: string): Promise<void> {
  expectPlaying = true;
  el.video.muted = !started || filmMuted;
  try {
    await el.video.play();
    log(`play ok (${reason}${el.video.muted ? ', tanpa suara' : ', bersuara'})`);
    if (started) show(el.startWrap, false);
    else showStart('Mulai nonton');
  } catch (err) {
    const name = (err as DOMException).name;
    log(`play ditolak (${reason}): ${name}`);
    if (name === 'NotAllowedError' && !el.video.muted) {
      // Sound needs a fresh tap: keep the picture going silently and ask for one.
      el.video.muted = true;
      await el.video.play().catch(() => {});
      showStart('Ketuk untuk menyalakan suara');
    } else {
      showStart(started ? 'Lanjut nonton' : 'Mulai nonton');
    }
  }
  render();
}

function showStart(label: string, hint?: string): void {
  el.startBtn.textContent = label;
  el.startHint.textContent = hint ?? '';
  show(el.startHint, Boolean(hint));
  show(el.startWrap, true);
  wake();
}

async function onStartTap(): Promise<void> {
  started = true;
  applyAudioSession();
  el.video.muted = filmMuted;
  try {
    await el.video.play();
    show(el.startWrap, false);
    log(`mulai nonton (${el.video.muted ? 'tanpa suara film' : 'bersuara'})`);
  } catch (err) {
    log(`mulai nonton gagal: ${(err as DOMException).name}`);
    showStart('Coba lagi', 'Video belum bisa diputar. Pastikan host sudah memilih tab.');
  }
  void requestWakeLock();
  wake();
  render();
}

function applyAudioSession(): void {
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (!session) return;
  try {
    session.type = el.sessionType.value;
    log(`mode audio: ${session.type}`);
  } catch (err) {
    log(`mode audio gagal: ${(err as Error).message}`);
  }
}

async function requestWakeLock(): Promise<void> {
  const wl = (navigator as Navigator & { wakeLock?: WakeLock }).wakeLock;
  if (!wl || document.visibilityState !== 'visible') return;
  if (wakeLock) return;
  try {
    const lock = await wl.request('screen');
    wakeLock = lock;
    log('layar dijaga tetap menyala');
    lock.addEventListener?.('release', () => {
      if (wakeLock === lock) wakeLock = null;
    });
  } catch {
    wakeLock = null;
    log('layar tidak bisa dijaga tetap menyala');
  }
}

// ---------- rendering ----------

let lastPill = '';
function render(): void {
  const state = pc?.connectionState;
  const playing = !el.video.paused && el.video.readyState >= 2;
  let cover = '';
  let pill = '';
  let dim = false;
  let ok = false;

  if (sigState !== 'open' && state !== 'connected') {
    cover = sigState === 'waiting' ? 'Server terputus, mencoba lagi…' : 'Menyambung ke room…';
    pill = 'Menyambung…';
    dim = Boolean(el.video.srcObject);
  } else if (!hostPresent && state !== 'connected') {
    cover = 'Host belum membuka room. Tunggu sebentar.';
    pill = 'Menunggu host';
  } else if (hostSharing === false) {
    cover = 'Host belum memilih tab untuk dibagikan.';
    pill = 'Menunggu host';
  } else if (state === 'connected') {
    pill = hostAudio === false ? 'Tersambung, tab tanpa suara' : 'Tersambung';
    ok = true;
    if (!playing && !el.startWrap.hidden) cover = '';
    else if (!playing) cover = 'Menunggu gambar…';
  } else if (state === 'disconnected' || state === 'failed') {
    cover = 'Koneksi terputus, menyambung ulang…';
    pill = 'Menyambung ulang';
    dim = true;
  } else {
    cover = 'Menghubungkan ke host…';
    pill = 'Menghubungkan…';
  }

  el.coverText.textContent = cover;
  show(el.cover, Boolean(cover) && el.startWrap.hidden);
  el.stage.dataset.dim = String(dim);
  el.pill.dataset.ok = String(ok);
  if (pill !== lastPill) {
    lastPill = pill;
    el.pill.textContent = pill;
  }
}

// ---------- controls ----------

const isFull = (): boolean => document.body.classList.contains('cinema') || document.fullscreenElement === el.player;

/** Show controls; in full screen they fade out after 3 s unless something needs them. In portrait they stay. */
function wake(): void {
  el.player.dataset.idle = 'false';
  window.clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => {
    const busy =
      !isFull() || !el.statsFloat.hidden || el.dock.contains(document.activeElement) || !el.startWrap.hidden || el.video.paused;
    if (!busy) el.player.dataset.idle = 'true';
  }, 3000);
}

const canElementFullscreen = (): boolean => typeof el.player.requestFullscreen === 'function' && document.fullscreenEnabled !== false;

function exitCinema(): void {
  document.body.classList.remove('cinema');
  updateFsLabel();
}

function updateFsLabel(): void {
  el.fsBtn.textContent = isFull() ? 'Keluar layar penuh' : 'Layar penuh';
  wake();
}

async function toggleFullscreen(): Promise<void> {
  if (canElementFullscreen() && !ios) {
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
    } else {
      try {
        await el.player.requestFullscreen({ navigationUI: 'hide' });
        await (screen.orientation as ScreenOrientation & { lock?(o: string): Promise<void> }).lock?.('landscape').catch(() => {});
      } catch {
        document.body.classList.add('cinema');
      }
    }
  } else {
    // iPhone has no element full screen; a fixed full-viewport stage keeps our overlays visible.
    document.body.classList.toggle('cinema');
  }
  updateFsLabel();
  wake();
}

function toggleStats(): void {
  const open = el.statsFloat.hidden;
  show(el.statsFloat, open);
  el.statsBtn.setAttribute('aria-pressed', String(open));
  if (open) startStats();
  else {
    window.clearInterval(statsTimer);
    stats = null;
  }
  wake();
}

function startStats(): void {
  window.clearInterval(statsTimer);
  if (!pc) {
    el.viewerStats.replaceChildren(row('Status', 'Belum ada koneksi video'));
    return;
  }
  stats = new StatsReader(pc, 'in');
  const tick = async () => {
    if (!stats) return;
    try {
      const s = await stats.read();
      const rows = statRows(s);
      const v = verdict(s);
      if (v) rows.unshift(['Kualitas', v]);
      el.viewerStats.replaceChildren(...(rows.length ? rows.map(([k, val]) => row(k, val)) : [row('Status', 'Mengumpulkan data…')]));
    } catch {
      /* pc closed */
    }
  };
  void tick();
  statsTimer = window.setInterval(tick, 1000);
}

function row(k: string, v: string): DocumentFragment {
  const f = document.createDocumentFragment();
  const dt = document.createElement('dt');
  dt.textContent = k;
  const dd = document.createElement('dd');
  dd.textContent = v;
  if (k === 'Kualitas') dd.className = 'verdict';
  f.append(dt, dd);
  return f;
}

// ---------- wiring ----------

el.pinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  void submitPin();
});
el.pin.addEventListener('input', () => {
  el.pin.removeAttribute('aria-invalid');
  const digits = el.pin.value.replace(/\D/g, '').slice(0, 6);
  if (digits !== el.pin.value) el.pin.value = digits;
  if (digits.length === 6) void submitPin(); // auto-submit, also after paste or one-time-code autofill
});
el.startBtn.addEventListener('click', () => void onStartTap());
el.soundBtn.addEventListener('click', () => {
  filmMuted = !filmMuted;
  el.soundBtn.setAttribute('aria-pressed', String(filmMuted));
  if (started) el.video.muted = filmMuted;
  log(filmMuted ? 'pilih: tanpa suara film' : 'pilih: suara film nyala');
  if (started && !filmMuted && el.video.paused) void el.video.play().catch(() => {});
  wake();
});
el.fsBtn.addEventListener('click', () => void toggleFullscreen());
el.statsBtn.addEventListener('click', toggleStats);
el.stage.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('button')) return;
  // Tap the picture: show controls, or hide them right away if they are showing (full screen only).
  if (el.player.dataset.idle === 'true' || !isFull()) wake();
  else {
    window.clearTimeout(idleTimer);
    el.player.dataset.idle = el.video.paused ? 'false' : 'true';
  }
});
el.dock.addEventListener('focusin', wake);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.body.classList.contains('cinema')) exitCinema();
});
document.addEventListener('fullscreenchange', updateFsLabel);

el.copyLogBtn.addEventListener('click', async () => {
  const header = `Nobar log · ${navigator.userAgent}\n`;
  flashLabel(el.copyLogBtn, (await copyText(header + logLines.join('\n'))) ? 'Catatan tersalin' : 'Gagal menyalin');
});

if ('audioSession' in navigator) {
  show(el.sessionField, true);
  try {
    el.sessionType.value = localStorage.getItem('nobar.audioSession') ?? 'auto';
  } catch {
    /* ignore */
  }
  el.sessionType.addEventListener('change', () => {
    try {
      localStorage.setItem('nobar.audioSession', el.sessionType.value);
    } catch {
      /* ignore */
    }
    applyAudioSession();
  });
}

for (const ev of ['playing', 'pause', 'waiting', 'stalled', 'ended', 'emptied'] as const) {
  el.video.addEventListener(ev, () => {
    log(`video: ${ev}${ev === 'pause' || ev === 'playing' ? (el.video.muted ? ' (tanpa suara)' : ' (bersuara)') : ''}`);
    render();
  });
}
el.video.addEventListener('volumechange', () => log(`video: ${el.video.muted ? 'dibisukan' : 'suara nyala'}`));
el.video.addEventListener('playing', wake);
el.video.addEventListener('pause', () => {
  // We never pause on purpose. A pause we did not ask for is usually a phone call or the OS taking audio.
  if (expectPlaying && el.video.srcObject && document.visibilityState === 'visible') {
    log('jeda yang tidak diminta (kemungkinan telepon)');
    if (started) showStart('Lanjut nonton', 'Video berhenti, mungkin karena telepon. Ketuk untuk melanjutkan.');
    else showStart('Mulai nonton');
  }
});

document.addEventListener('visibilitychange', () => {
  log(`halaman ${document.visibilityState === 'visible' ? 'terlihat' : 'di latar belakang'}`);
  if (document.visibilityState !== 'visible') return;
  void requestWakeLock();
  if (el.video.srcObject && el.video.paused && expectPlaying) void play('kembali ke halaman');
  if (pc?.connectionState !== 'connected') sendHello(true);
});

// ---------- start ----------

if (!ROOM_ID_RE.test(roomId)) {
  showGone('Tautan tidak lengkap', 'Buka lagi tautan dari host. Tautannya berbentuk …/w/ diikuti 8 huruf dan angka.');
} else {
  el.roomLabel.textContent = `Room ${roomId}`;
  const app = inAppBrowser();
  if (app) {
    el.inApp.textContent = `Kamu membuka tautan di dalam ${app}. Untuk suara dan layar penuh yang lebih andal, buka di Safari atau Chrome.`;
    show(el.inApp, true);
  }
  log(`perangkat: ${ios ? 'iOS' : 'bukan iOS'}, audioSession ${'audioSession' in navigator ? 'ada' : 'tidak ada'}`);
  const token = getToken();
  if (token) startWatching(token);
  else showGate();
}
