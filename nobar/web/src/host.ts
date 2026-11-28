import { CLOSE, type CreateRoomResponse, type ServerMsg, type Signal } from '../../shared/protocol';
import { $, copyText, fetchIce, FALLBACK_ICE, flashLabel, postJson, randomId, show } from './lib/dom';
import { orderVideoCodecs, scaleFor, tuneOpus } from './lib/sdp';
import { Signaling } from './lib/signaling';
import { StatsReader, statRows, verdict, describePath } from './lib/stats';

interface SavedRoom {
  roomId: string;
  pin: string;
  token: string;
}

const STORE_KEY = 'nobar.host';
/** MVP default ("Otomatis"): cap at 1080p and 4 Mbps; Chrome's congestion control goes lower when needed. */
const DEFAULT_MAX_BITRATE = 4_000_000;
const MAX_HEIGHT = 1080;
const AUDIO_BITRATE = 128_000;

const el = {
  intro: $('intro'),
  unsupported: $('unsupported'),
  previousNote: $('previousNote'),
  createBtn: $<HTMLButtonElement>('createBtn'),
  createError: $('createError'),
  invitePanel: $('invitePanel'),
  linkOut: $('linkOut'),
  pinOut: $('pinOut'),
  copyMsgBtn: $<HTMLButtonElement>('copyMsgBtn'),
  copyLinkBtn: $<HTMLButtonElement>('copyLinkBtn'),
  sharePanel: $('sharePanel'),
  shareState: $('shareState'),
  preview: $<HTMLVideoElement>('preview'),
  shareGrid: $('shareGrid'),
  noAudio: $('noAudio'),
  shareError: $('shareError'),
  shareBtn: $<HTMLButtonElement>('shareBtn'),
  stopBtn: $<HTMLButtonElement>('stopBtn'),
  viewerPanel: $('viewerPanel'),
  viewerState: $('viewerState'),
  hostStats: $('hostStats'),
  turnNote: $('turnNote'),
  endPanel: $('endPanel'),
  endBtn: $<HTMLButtonElement>('endBtn'),
  endDialog: $<HTMLDialogElement>('endDialog'),
  endCancel: $<HTMLButtonElement>('endCancel'),
  endConfirm: $<HTMLButtonElement>('endConfirm'),
};

let saved: SavedRoom | null = loadRoom();
let sig: Signaling | null = null;
let stream: MediaStream | null = null;
let pc: RTCPeerConnection | null = null;
let pcId: string | null = null;
let pendingIce: RTCIceCandidateInit[] = [];
let ice: { servers: RTCIceServer[]; turn: boolean; at: number } = { servers: FALLBACK_ICE, turn: false, at: 0 };
let viewerPresent = false;
let restartCount = 0;
let lastRestart = 0;
let disconnectTimer: number | undefined;
let statsTimer: number | undefined;
let stats: StatsReader | null = null;

// ---------- storage ----------

function loadRoom(): SavedRoom | null {
  try {
    const raw = sessionStorage.getItem(STORE_KEY) ?? localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as SavedRoom) : null;
  } catch {
    return null;
  }
}
function saveRoom(r: SavedRoom | null): void {
  try {
    if (r) {
      sessionStorage.setItem(STORE_KEY, JSON.stringify(r));
      localStorage.setItem(STORE_KEY, JSON.stringify(r));
    } else {
      sessionStorage.removeItem(STORE_KEY);
      localStorage.removeItem(STORE_KEY);
    }
  } catch {
    /* private mode: the room still works for this tab */
  }
}

// ---------- room lifecycle ----------

function watchLink(r: SavedRoom): string {
  return `${location.origin}/w/${r.roomId}`;
}

function showRoom(r: SavedRoom): void {
  show(el.intro, false);
  [el.invitePanel, el.sharePanel, el.viewerPanel, el.endPanel].forEach((p) => show(p, true));
  el.linkOut.textContent = watchLink(r);
  el.pinOut.textContent = `${r.pin.slice(0, 3)} ${r.pin.slice(3)}`;
  el.pinOut.setAttribute('aria-label', `PIN ${r.pin.split('').join(' ')}`);
}

function showIntro(message?: string): void {
  [el.invitePanel, el.sharePanel, el.viewerPanel, el.endPanel].forEach((p) => show(p, false));
  show(el.intro, true);
  el.previousNote.textContent = message ?? '';
  show(el.previousNote, Boolean(message));
}

async function createRoom(): Promise<void> {
  el.createBtn.disabled = true;
  el.createBtn.textContent = 'Membuat room…';
  show(el.createError, false);
  const { status, data } = await postJson<CreateRoomResponse>('/api/rooms', {});
  el.createBtn.disabled = false;
  el.createBtn.textContent = 'Buat room';
  if (status !== 201 || !data) {
    el.createError.textContent =
      status === 0 ? 'Tidak ada koneksi internet. Periksa jaringan lalu coba lagi.' : 'Server tidak bisa membuat room. Coba lagi sebentar lagi.';
    show(el.createError, true);
    return;
  }
  saved = data;
  saveRoom(saved);
  showRoom(saved);
  connect(saved);
}

function connect(r: SavedRoom): void {
  sig?.close();
  sig = new Signaling(r.roomId, r.token);
  sig.onMessage = onServer;
  sig.onState = (s) => {
    if (s !== 'open' && !pcConnected()) setViewer('Menyambung ke server…', 'idle');
  };
  sig.onFatal = (code) => {
    stopShare(false);
    saveRoom(null);
    saved = null;
    if (code === CLOSE.replaced) {
      showIntro('Room ini sekarang dibuka di tab lain. Tutup tab ini, atau buat room baru.');
    } else if (code === CLOSE.ended) {
      showIntro('Room sudah diakhiri.');
    } else {
      showIntro('Room sebelumnya sudah kedaluwarsa atau tidak ditemukan. Buat room baru.');
    }
  };
  sig.connect();
  void refreshIce();
}

async function refreshIce(): Promise<void> {
  if (!saved || Date.now() - ice.at < 3 * 60 * 60 * 1000) return;
  const got = await fetchIce(saved.roomId, saved.token);
  ice = { ...got, at: Date.now() };
}

function onServer(m: ServerMsg): void {
  switch (m.t) {
    case 'welcome':
      viewerPresent = m.peer;
      renderViewer();
      break;
    case 'peer':
      if (m.role === 'viewer') {
        viewerPresent = m.present;
        renderViewer();
      }
      break;
    case 'signal':
      void onSignal(m.data);
      break;
    case 'ended':
      break; // followed by close code 4004 → onFatal
    case 'error':
      break;
  }
}

async function onSignal(s: Signal): Promise<void> {
  if (s.k === 'hello') {
    viewerPresent = true;
    if (!stream) {
      sig?.signal({ k: 'status', sharing: false, audio: false });
      renderViewer();
      return;
    }
    if (pc && s.pcId === pcId) {
      if (pc.connectionState !== 'connected') await restartIce('viewer minta');
      return;
    }
    await startPc();
  } else if (s.k === 'answer') {
    if (!pc || s.pcId !== pcId || pc.signalingState !== 'have-local-offer') return;
    try {
      await pc.setRemoteDescription({ type: 'answer', sdp: tuneOpus(s.sdp, AUDIO_BITRATE) });
      for (const c of pendingIce.splice(0)) await pc.addIceCandidate(c).catch(() => {});
    } catch (err) {
      console.warn('setRemoteDescription failed', err);
    }
  } else if (s.k === 'ice') {
    if (!pc || s.pcId !== pcId) return;
    if (!pc.remoteDescription) pendingIce.push(s.cand);
    else await pc.addIceCandidate(s.cand).catch(() => {});
  }
}

// ---------- capture ----------

async function startShare(): Promise<void> {
  show(el.shareError, false);
  if (!navigator.mediaDevices?.getDisplayMedia) {
    el.shareError.textContent = 'Browser ini tidak bisa membagikan tab. Pakai Chrome atau Edge di laptop.';
    show(el.shareError, true);
    return;
  }
  const controller = 'CaptureController' in window ? new (window as any).CaptureController() : undefined;
  let next: MediaStream;
  try {
    next = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { max: 1920 }, height: { max: 1080 }, frameRate: { ideal: 30, max: 30 } },
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 2,
        suppressLocalAudioPlayback: false,
      } as MediaTrackConstraints,
      // Chrome-only hints; other browsers ignore unknown keys.
      displaySurface: 'browser',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
      monitorTypeSurfaces: 'exclude',
      systemAudio: 'exclude',
      preferCurrentTab: false,
      ...(controller ? { controller } : {}),
    } as DisplayMediaStreamOptions);
  } catch (err) {
    const name = (err as DOMException)?.name;
    if (name !== 'NotAllowedError' && name !== 'AbortError') {
      el.shareError.textContent = 'Tab tidak bisa dibagikan. Coba lagi, atau muat ulang halaman ini.';
      show(el.shareError, true);
    }
    return;
  }
  try {
    // Go to the shared tab so the host can press play there.
    controller?.setFocusBehavior?.('focus-captured-surface');
  } catch {
    /* only allowed right after the promise resolves */
  }

  const old = stream;
  stream = next;
  const vt = next.getVideoTracks()[0];
  const at = next.getAudioTracks()[0];
  if (vt) {
    vt.contentHint = 'motion'; // films: keep the frame rate, give up resolution first
    vt.addEventListener('ended', () => stopShare(true));
  }
  if (at) at.contentHint = 'music';
  old?.getTracks().forEach((t) => t.stop());

  el.preview.srcObject = next;
  show(el.preview, true);
  el.shareGrid.classList.add('has-preview');
  show(el.noAudio, !at);
  el.shareBtn.textContent = 'Ganti tab';
  el.shareBtn.classList.remove('primary', 'big');
  show(el.stopBtn, true);
  setShareState(at ? 'Sedang berbagi tab dengan suara' : 'Sedang berbagi tab tanpa suara', at ? 'ok' : 'warn');

  if (viewerPresent) await startPc();
  else sig?.signal({ k: 'status', sharing: true, audio: Boolean(at) });
  renderViewer();
}

function stopShare(notify: boolean): void {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  closePc();
  el.preview.srcObject = null;
  show(el.preview, false);
  el.shareGrid.classList.remove('has-preview');
  show(el.noAudio, false);
  show(el.stopBtn, false);
  el.shareBtn.textContent = 'Pilih tab';
  el.shareBtn.classList.add('primary', 'big');
  setShareState('Belum ada tab yang dibagikan', 'idle');
  if (notify) sig?.signal({ k: 'status', sharing: false, audio: false });
  renderViewer();
}

// ---------- peer connection ----------

function pcConnected(): boolean {
  return pc?.connectionState === 'connected';
}

function closePc(): void {
  window.clearTimeout(disconnectTimer);
  window.clearInterval(statsTimer);
  stats = null;
  pc?.close();
  pc = null;
  pcId = null;
  pendingIce = [];
  show(el.hostStats, false);
}

async function startPc(): Promise<void> {
  if (!stream || !sig) return;
  await refreshIce();
  closePc();
  restartCount = 0;
  const id = randomId();
  const conn = new RTCPeerConnection({ iceServers: ice.servers, bundlePolicy: 'max-bundle' });
  pc = conn;
  pcId = id;

  const vt = stream.getVideoTracks()[0];
  const at = stream.getAudioTracks()[0];
  if (vt) {
    const h = vt.getSettings().height;
    const tx = conn.addTransceiver(vt, {
      direction: 'sendonly',
      streams: [stream],
      sendEncodings: [{ maxBitrate: DEFAULT_MAX_BITRATE, maxFramerate: 30, scaleResolutionDownBy: scaleFor(h, MAX_HEIGHT) }],
    });
    const caps = RTCRtpSender.getCapabilities?.('video');
    if (caps && 'setCodecPreferences' in tx) {
      try {
        tx.setCodecPreferences(orderVideoCodecs(caps.codecs));
      } catch (err) {
        console.warn('setCodecPreferences failed', err);
      }
    }
  }
  if (at) {
    conn.addTransceiver(at, { direction: 'sendonly', streams: [stream], sendEncodings: [{ maxBitrate: AUDIO_BITRATE }] });
  }

  conn.onicecandidate = (e) => {
    if (e.candidate && pcId === id) sig?.signal({ k: 'ice', pcId: id, cand: e.candidate.toJSON() as never });
  };
  conn.onconnectionstatechange = () => {
    if (pc !== conn) return;
    onPcState(conn.connectionState);
  };

  const offer = await conn.createOffer();
  await conn.setLocalDescription(offer);
  await tuneSenders(conn);
  sig.signal({ k: 'offer', pcId: id, sdp: conn.localDescription?.sdp ?? offer.sdp ?? '' });
  setViewer('Menghubungkan ke penonton…', 'idle');
}

/** Ask the encoder to keep motion smooth and give audio packets priority. Chrome supports degradationPreference since M83. */
async function tuneSenders(conn: RTCPeerConnection): Promise<void> {
  for (const sender of conn.getSenders()) {
    if (!sender.track) continue;
    const p = sender.getParameters() as RTCRtpSendParameters & { degradationPreference?: string };
    if (!p.encodings?.length) continue;
    if (sender.track.kind === 'video') {
      p.degradationPreference = 'maintain-framerate';
    } else {
      p.encodings[0].priority = 'high';
      p.encodings[0].networkPriority = 'high';
    }
    try {
      await sender.setParameters(p);
    } catch (err) {
      console.warn('setParameters failed', err);
    }
  }
}

function onPcState(state: RTCPeerConnectionState): void {
  window.clearTimeout(disconnectTimer);
  if (state === 'connected') {
    restartCount = 0;
    startStats();
  } else if (state === 'disconnected') {
    disconnectTimer = window.setTimeout(() => void restartIce('terputus 3 detik'), 3000);
  } else if (state === 'failed') {
    void restartIce('gagal');
  }
  renderViewer();
}

async function restartIce(_why: string): Promise<void> {
  if (!pc || !pcId || !sig) return;
  if (Date.now() - lastRestart < 4000) return;
  lastRestart = Date.now();
  restartCount++;
  if (restartCount > 2) {
    await startPc(); // fresh connection; the viewer swaps it into the same <video>
    return;
  }
  try {
    const offer = await pc.createOffer({ iceRestart: true });
    await pc.setLocalDescription(offer);
    sig.signal({ k: 'offer', pcId, sdp: pc.localDescription?.sdp ?? offer.sdp ?? '' });
  } catch (err) {
    console.warn('ICE restart failed', err);
    await startPc();
  }
}

// ---------- rendering ----------

function setShareState(text: string, tone: 'idle' | 'ok' | 'warn' | 'err'): void {
  el.shareState.textContent = text;
  el.shareState.dataset.tone = tone;
}

let lastViewerText = '';
function setViewer(text: string, tone: 'idle' | 'ok' | 'warn' | 'err'): void {
  if (text === lastViewerText) return;
  lastViewerText = text;
  el.viewerState.textContent = text;
  el.viewerState.dataset.tone = tone;
}

function renderViewer(): void {
  const state = pc?.connectionState;
  if (state === 'connected') {
    setViewer('Tersambung, sedang menonton', 'ok');
  } else if (state === 'disconnected' || state === 'failed') {
    setViewer('Koneksi ke penonton terputus, menyambung ulang…', 'warn');
  } else if (state === 'new' || state === 'connecting') {
    setViewer('Menghubungkan ke penonton…', 'idle');
  } else if (viewerPresent) {
    setViewer(stream ? 'Penonton sudah masuk' : 'Penonton sudah masuk, menunggu kamu memilih tab', 'idle');
  } else {
    setViewer('Belum masuk. Kirim tautan dan PIN di atas.', 'idle');
  }
  el.turnNote.textContent = ice.turn
    ? 'Relay TURN siap dipakai bila koneksi langsung gagal.'
    : 'Relay TURN belum diatur: bila jaringan salah satu pihak ketat, koneksi bisa gagal.';
  show(el.turnNote, Boolean(saved));
}

function startStats(): void {
  if (!pc) return;
  stats = new StatsReader(pc, 'out');
  window.clearInterval(statsTimer);
  const tick = async () => {
    if (!stats) return;
    try {
      const s = await stats.read();
      const rows = statRows(s);
      const v = verdict(s);
      el.hostStats.replaceChildren();
      if (v) rows.unshift(['Kualitas koneksi', v]);
      for (const [k, val] of rows) {
        const dt = document.createElement('dt');
        dt.textContent = k;
        const dd = document.createElement('dd');
        dd.textContent = val;
        if (k === 'Kualitas koneksi') dd.className = 'verdict';
        el.hostStats.append(dt, dd);
      }
      show(el.hostStats, rows.length > 0);
      const path = describePath(s);
      if (path && pcConnected()) setViewer(`Tersambung, ${path}`, 'ok');
    } catch {
      /* pc closed between ticks */
    }
  };
  void tick();
  statsTimer = window.setInterval(tick, 2000);
}

// ---------- wiring ----------

el.createBtn.addEventListener('click', () => void createRoom());
el.shareBtn.addEventListener('click', () => void startShare());
el.stopBtn.addEventListener('click', () => stopShare(true));
el.copyLinkBtn.addEventListener('click', async () => {
  if (!saved) return;
  flashLabel(el.copyLinkBtn, (await copyText(watchLink(saved))) ? 'Tautan tersalin' : 'Gagal menyalin');
});
el.copyMsgBtn.addEventListener('click', async () => {
  if (!saved) return;
  const msg = `Nonton bareng yuk. Buka di Safari atau Chrome:\n${watchLink(saved)}\nPIN: ${saved.pin}`;
  flashLabel(el.copyMsgBtn, (await copyText(msg)) ? 'Pesan tersalin' : 'Gagal menyalin');
});
el.endBtn.addEventListener('click', () => el.endDialog.showModal());
el.endCancel.addEventListener('click', () => el.endDialog.close());
el.endConfirm.addEventListener('click', () => {
  el.endDialog.close();
  sig?.send({ t: 'end' });
  // The server answers with close code 4004; fall back locally if the socket is down.
  if (!sig?.isOpen) {
    stopShare(false);
    sig?.close();
    saveRoom(null);
    saved = null;
    showIntro('Room sudah diakhiri.');
  }
});

if (!navigator.mediaDevices?.getDisplayMedia) {
  show(el.unsupported, true);
  el.createBtn.disabled = true;
}

if (saved) {
  showRoom(saved);
  connect(saved);
  renderViewer();
}
