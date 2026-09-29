// The production build (tools/build.js) served from dist/web: hashed bundles, WGSL inlined, no dev code,
// and the same game as in development (GPU swarm, renderer, job workers).
import { test, expect } from '@playwright/test';
import { PORTS } from './playwright.config.js';

test('the production build boots from dist/web with hashed bundles, inlined shaders and no dev code', async ({ page }) => {
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const paths = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('request', (r) => paths.push(new URL(r.url()).pathname));
  const base = `http://127.0.0.1:${PORTS.prod}`;
  await page.goto(`${base}/index.html?units=4096&shots=1024`);
  await page.waitForFunction(() => window.__px?.status !== 'booting' && !!window.__px?.hud && window.__px.frames > 2, null, { timeout: 60_000 });
  const px = await page.evaluate(() => window.__px);
  expect(px?.error ?? null).toBeNull();
  expect(px?.status).toBe('ok');
  expect(px?.threading).toBe('shared');
  expect(px?.engine?.jobWorkers).toBeGreaterThan(0);
  expect(px?.engine?.swarm?.backend).toBe('gpu');

  const build = await (await page.request.get(`${base}/build.json`)).json();
  expect(build.buildHash).toMatch(/^[0-9a-f]{16}$/);
  await page.waitForFunction(() => (window.__px?.hud?.kills ?? 0) > 0, null, { timeout: 60_000 });
  const pixels = await page.evaluate(async () => {
    const c = await /** @type {NonNullable<typeof window.__px>} */ (window.__px).capture();
    const count = (/** @type {number} */ hex) => {
      let n = 0;
      for (let i = 0; i < c.data.length; i += 4) if (((c.data[i] << 16) | (c.data[i + 1] << 8) | c.data[i + 2]) === hex) n++;
      return n;
    };
    return { orange: count(c.palette['sodium-500']), cyan: count(c.palette['cyan-400']) };
  });
  expect(pixels.orange).toBeGreaterThan(0);
  expect(pixels.cyan).toBeGreaterThan(0);

  expect(await page.evaluate(() => /** @type {any} */ (globalThis).DEV)).toBe(false);
  expect(paths.filter((p) => p.endsWith('.wgsl') || p.startsWith('/engine/') || p.startsWith('/game/'))).toEqual([]);
  expect(paths).not.toContain('/__events'); // no live reload
  const scripts = paths.filter((p) => p.endsWith('.js'));
  expect(scripts.length).toBeGreaterThanOrEqual(3); // main, engine worker, job workers
  for (const s of scripts) expect(s).toMatch(/^\/(main|engine-worker|job-worker)-[0-9a-f]{10}\.js$/);
  expect(errors).toEqual([]);
});
