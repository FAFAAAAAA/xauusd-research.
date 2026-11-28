// End-to-end: one desktop Chromium as host, one phone-sized Chromium as viewer, real WebRTC between them.
// getDisplayMedia is replaced by an animated canvas plus a tone, because headless Chromium has no tab picker.
// Usage: npm run test:e2e   (starts `wrangler dev` itself unless BASE is set)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const PORT = 8798;
const BASE = process.env.BASE ?? `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.SHOTS ?? 'test-results';
mkdirSync(SHOTS, { recursive: true });

let server;
if (!process.env.BASE) {
  server = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(BASE)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
}

const fakeCapture = () => {
  navigator.mediaDevices.getDisplayMedia = async () => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 1280, height: 720 });
    const ctx = canvas.getContext('2d');
    let n = 0;
    setInterval(() => {
      n++;
      ctx.fillStyle = `hsl(${(n * 3) % 360} 60% 40%)`;
      ctx.fillRect(0, 0, 1280, 720);
      ctx.fillStyle = '#fff';
      ctx.font = '96px sans-serif';
      ctx.fillText(`frame ${n}`, 100, 380);
    }, 33);
    const video = canvas.captureStream(30);
    const ac = new AudioContext();
    const osc = ac.createOscillator();
    const dest = ac.createMediaStreamDestination();
    osc.connect(dest);
    osc.start();
    return new MediaStream([...video.getVideoTracks(), ...dest.stream.getAudioTracks()]);
  };
};

const results = [];
const errors = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const watchConsole = (page, who) => {
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${who}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`${who}: ${e.message}`));
};

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--autoplay-policy=user-gesture-required'] });
try {
  const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
  await hostCtx.addInitScript(fakeCapture);
  await hostCtx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const host = await hostCtx.newPage();
  watchConsole(host, 'host');
  await host.goto(BASE);
  await host.screenshot({ path: `${SHOTS}/1-host-intro.png` });

  await host.click('#createBtn');
  await host.waitForSelector('#invitePanel:not([hidden])');
  const link = (await host.textContent('#linkOut')).trim();
  const pin = (await host.textContent('#pinOut')).replace(/\s/g, '');
  check('host membuat room', /\/w\/[A-Z2-9]{8}$/.test(link) && /^\d{6}$/.test(pin), `${link} PIN ${pin}`);

  await host.click('#copyMsgBtn');
  const clip = await host.evaluate(() => navigator.clipboard.readText());
  check('salin pesan WhatsApp berisi tautan dan PIN', clip.includes(link) && clip.includes(pin));

  await host.click('#shareBtn');
  await host.waitForFunction(() => document.querySelector('#shareState')?.textContent?.includes('dengan suara'));
  check('host berbagi tab dengan suara', true);

  // Wrong PIN from another phone first.
  const strangerCtx = await browser.newContext({ ...devices['iPhone 13'], browserName: undefined });
  const stranger = await strangerCtx.newPage();
  await stranger.goto(link);
  await stranger.fill('#pin', pin === '000000' ? '111111' : '000000');
  await stranger.waitForSelector('#pinError:not([hidden])');
  const wrong = await stranger.textContent('#pinError');
  check('PIN salah ditolak dengan sisa percobaan', /Sisa 4/.test(wrong), wrong);
  await strangerCtx.close();

  const viewerCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const viewer = await viewerCtx.newPage();
  watchConsole(viewer, 'viewer');
  await viewer.goto(link);
  await viewer.waitForSelector('#gate:not([hidden])');
  await viewer.screenshot({ path: `${SHOTS}/2-viewer-pin.png` });
  await viewer.fill('#pin', pin);
  await viewer.waitForSelector('#startBtn', { state: 'visible', timeout: 20000 });
  check('penonton masuk dengan PIN, tombol Mulai nonton muncul', true);
  await viewer.screenshot({ path: `${SHOTS}/3-viewer-start.png` });

  await viewer.click('#startBtn');
  await viewer.waitForFunction(() => {
    const v = document.querySelector('video');
    return v && !v.paused && v.videoWidth > 0 && v.currentTime > 1;
  }, null, { timeout: 20000 });
  const media = await viewer.evaluate(() => {
    const v = document.querySelector('video');
    return { muted: v.muted, w: v.videoWidth, h: v.videoHeight, audio: v.srcObject.getAudioTracks().length };
  });
  check('video tampil dan bersuara setelah ketuk', !media.muted && media.w > 0 && media.audio === 1, JSON.stringify(media));

  await host.waitForFunction(() => document.querySelector('#viewerState')?.textContent?.startsWith('Tersambung'), null, { timeout: 15000 });
  check('host melihat penonton tersambung', true, await host.textContent('#viewerState'));

  await viewer.click('#statsBtn');
  await viewer.waitForFunction(() => /FPS/.test(document.querySelector('#viewerStats')?.textContent ?? ''), null, { timeout: 8000 });
  await viewer.waitForTimeout(4000);
  const statText = await viewer.textContent('#viewerStats');
  check('statistik penonton tampil', /Resolusi/.test(statText) && /FPS/.test(statText), statText.replace(/\s+/g, ' ').slice(0, 120));
  await viewer.screenshot({ path: `${SHOTS}/4-viewer-playing-stats.png` });
  await viewer.click('#statsBtn');

  await viewer.click('#fsBtn');
  const fsOn = await viewer
    .waitForFunction(() => document.querySelector('#fsBtn').textContent === 'Keluar layar penuh' && (document.body.classList.contains('cinema') || document.fullscreenElement !== null), null, { timeout: 5000 })
    .then(() => true, () => false);
  await viewer.click('#fsBtn');
  const fsOff = await viewer
    .waitForFunction(() => document.querySelector('#fsBtn').textContent === 'Layar penuh' && !document.fullscreenElement && !document.body.classList.contains('cinema'), null, { timeout: 5000 })
    .then(() => true, () => false);
  check('tombol layar penuh masuk dan keluar', fsOn && fsOff);
  // iPhone path (CSS full screen), shown in landscape for the screenshot.
  await viewer.setViewportSize({ width: 844, height: 390 });
  await viewer.evaluate(() => document.body.classList.add('cinema'));
  await viewer.screenshot({ path: `${SHOTS}/5-viewer-fullscreen-landscape.png` });
  await viewer.keyboard.press('Escape');
  check('Escape keluar dari layar penuh CSS', await viewer.evaluate(() => !document.body.classList.contains('cinema')));
  await viewer.setViewportSize({ width: 390, height: 844 });

  await viewer.click('#soundBtn');
  check('tombol "Tanpa suara film" membisukan', await viewer.evaluate(() => document.querySelector('video').muted && document.querySelector('#soundBtn').getAttribute('aria-pressed') === 'true'));
  await viewer.click('#soundBtn');

  const hostShot = await host.screenshot({ path: `${SHOTS}/6-host-connected.png`, fullPage: true });
  void hostShot;

  // Reload: token is remembered, no PIN, one tap, playback again.
  await viewer.reload();
  await viewer.waitForSelector('#startBtn', { state: 'visible', timeout: 20000 });
  check('setelah reload tidak perlu PIN lagi', await viewer.isHidden('#gate'));
  await viewer.click('#startBtn');
  await viewer.waitForFunction(() => {
    const v = document.querySelector('video');
    return v && !v.paused && v.currentTime > 1;
  }, null, { timeout: 20000 });
  check('penonton tersambung ulang setelah reload', true);

  // Network drop on the viewer: ICE restart or new connection.
  await viewerCtx.setOffline(true);
  await viewer.waitForTimeout(6000);
  await viewerCtx.setOffline(false);
  const resumed = await viewer
    .waitForFunction(() => {
      const v = document.querySelector('video');
      return v && !v.paused && v.readyState >= 2 && document.querySelector('#pill')?.textContent?.startsWith('Tersambung');
    }, null, { timeout: 45000 })
    .then(() => true, () => false);
  check('pulih sendiri setelah internet penonton putus 6 detik', resumed, await viewer.textContent('#pill'));

  // Host stops and starts sharing again.
  await host.click('#stopBtn');
  await viewer.waitForFunction(() => document.querySelector('#coverText')?.textContent?.includes('belum memilih tab'), null, { timeout: 10000 });
  check('penonton diberi tahu host berhenti berbagi', true);
  await host.click('#shareBtn');
  const back = await viewer
    .waitForFunction(() => {
      const v = document.querySelector('video');
      return v && !v.paused && !v.muted && v.currentTime > 0.5;
    }, null, { timeout: 20000 })
    .then(() => true, () => false);
  check('berbagi lagi: video kembali tanpa ketuk ulang', back);

  // Host ends the room.
  await host.click('#endBtn');
  await host.click('#endConfirm');
  await viewer.waitForSelector('#gone:not([hidden])', { timeout: 10000 });
  check('akhiri room: penonton melihat room berakhir', (await viewer.textContent('#goneTitle')).includes('berakhir'));
  await host.waitForSelector('#intro:not([hidden])');
  check('akhiri room: host kembali ke awal', true);
  await viewer.screenshot({ path: `${SHOTS}/7-viewer-ended.png` });
} catch (err) {
  check('skenario selesai tanpa error', false, String(err?.message ?? err).split('\n')[0]);
} finally {
  await browser.close();
  server?.kill();
}

const real = errors.filter((e) => !/favicon/.test(e));
check('tidak ada error di console', real.length === 0, real.slice(0, 3).join(' | '));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} lolos`);
process.exit(failed.length ? 1 : 0);
