/**
 * Capture README screenshots from a production build.
 *
 *   npm run build && npm run screenshot
 *
 * Starts `vite preview`, opens the app in headless Chrome, lets the
 * simulation run for a while at high speed and saves PNGs to docs/.
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const PORT = 4791;
const URL_BASE = `http://localhost:${PORT}/dishbrain-playground/`;

async function waitFor(url: string, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server did not start at ${url}`);
}

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
});
try {
  await waitFor(URL_BASE);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const shots: { name: string; width: number; height: number; theme: string }[] = [
    { name: 'screenshot', width: 1440, height: 1000, theme: 'dark' },
    { name: 'screenshot-light', width: 1440, height: 1000, theme: 'light' },
    { name: 'screenshot-mobile', width: 390, height: 1400, theme: 'dark' },
  ];
  for (const s of shots) {
    const ctx = await browser.newContext({
      viewport: { width: s.width, height: s.height },
      deviceScaleFactor: 2,
      colorScheme: s.theme as 'dark' | 'light',
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('page error:', e.message));
    page.on('console', (m) => m.type() === 'error' && console.error('console:', m.text()));
    await page.goto(URL_BASE);
    await page.evaluate((t) => {
      try {
        localStorage.setItem('dishbrain-theme', t);
      } catch {
        /* ignore */
      }
    }, s.theme);
    await page.reload();
    // Run at 50x for a few seconds so the charts have content, then back to 1x.
    await page.locator('#speed').fill('5');
    await page.waitForTimeout(6000);
    await page.locator('#speed').fill('0');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `docs/${s.name}.png` });
    console.log(`saved docs/${s.name}.png`);
    await ctx.close();
  }
  await browser.close();
} finally {
  server.kill();
}
