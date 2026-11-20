// UI smoke test: opens every page in a real browser (phone + desktop, light + dark) and fails on
//   - a JavaScript error or a React warning (e.g. duplicate keys, hydration mismatch),
//   - an error box on the page (e.g. the database cannot be reached),
//   - sideways scrolling (something wider than the screen).
// It only READS pages: nothing is clicked, saved or sent.
//
// Run against the local dev server (React warnings only exist in development builds):
//   npm run dev            (with DATABASE_URL set, in another terminal)
//   npm run test:ui
// Or against any deploy, e.g. after going live:
//   BASE_URL=https://xauusd-research.vercel.app npm run test:ui
// First time on a new machine: npx playwright install chromium
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, devices, type Browser } from 'playwright';

const BASE = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const PAGES = ['/', '/trade', '/analytics', '/calculator', '/settings'];
const VIEWS = { phone: { ...devices['iPhone 13'] }, desktop: { viewport: { width: 1440, height: 900 } } };
const THEMES = ['light', 'dark'] as const;
// Third-party price / weather APIs (Binance, open-meteo) can be blocked or rate-limited from some networks.
// The browser reports those as resource errors; they are not bugs in this site.
const EXTERNAL = /^(Failed to load resource|Access to fetch at '(https:\/\/(fapi\.binance\.com|data-api\.binance\.vision|api\.binance\.com|api\.open-meteo\.com)))/;

let browser: Browser;
before(async () => {
  browser = await chromium.launch();
  // checked through the browser itself, so it takes the same network route (and proxy) as the pages
  const page = await browser.newPage();
  const ok = await page.goto(`${BASE}/api/health`, { timeout: 30_000 }).then((r) => !!r?.ok()).catch(() => false);
  await page.close();
  assert.ok(ok, `Server tidak bisa dihubungi di ${BASE} (jalankan "npm run dev" dulu, atau set BASE_URL)`);
});
after(async () => { await browser?.close(); });

for (const [view, opts] of Object.entries(VIEWS)) {
  for (const theme of THEMES) {
    test(`semua halaman terbuka tanpa error · ${view} · ${theme}`, async () => {
      const ctx = await browser.newContext({ ...opts, reducedMotion: 'reduce' });
      // skip the "installed app opens on the office" redirect and pick the theme, like a returning visitor
      await ctx.addInitScript((t) => {
        try { sessionStorage.setItem('xau_booted', '1'); localStorage.setItem('xau.theme', t); } catch { /* storage blocked */ }
      }, theme);
      const page = await ctx.newPage();
      const problems: string[] = [];
      let at = '';
      page.on('pageerror', (e) => problems.push(`${at}: JavaScript error: ${e.message}`));
      page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const text = m.text();
        if (!EXTERNAL.test(text)) problems.push(`${at}: console: ${text.replace(/\s+/g, ' ').slice(0, 300)}`);
      });
      try {
        for (const path of PAGES) {
          at = path;
          const res = await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 60_000 });
          assert.ok(res && res.status() < 400, `${path}: HTTP ${res?.status()}`);
          await page.waitForTimeout(1500);   // client data loads after the first paint
          const s = await page.evaluate(() => ({
            overflow: document.documentElement.scrollWidth - window.innerWidth,
            heading: !!document.querySelector('.page-head h1, .office, canvas'),
            errorBox: [...document.querySelectorAll('[role="alert"].error')].map((e) => (e.textContent ?? '').trim()).filter(Boolean),
          }));
          assert.ok(s.heading, `${path}: halaman kosong (tidak ada judul / kantor)`);
          assert.equal(s.errorBox.length, 0, `${path}: kotak error tampil: ${s.errorBox.join(' | ')}`);
          assert.ok(s.overflow <= 1, `${path}: halaman bisa digeser ke samping (${s.overflow}px lebih lebar dari layar)`);
        }
        assert.deepEqual(problems, [], `error di browser:\n${problems.join('\n')}`);
      } finally {
        await ctx.close();
      }
    });
  }
}
