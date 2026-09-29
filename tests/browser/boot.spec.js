import { test, expect } from '@playwright/test';
import { PORTS } from './playwright.config.js';

/** Small swarm pools keep SwiftShader fast; swarm.spec.js covers the large scales. */
const POOLS = 'units=4096&shots=1024';

/**
 * Opens a page, collects errors, and waits until the boot finished (ok, error or unsupported).
 * @param {import('@playwright/test').Page} page
 * @param {string} url
 */
async function boot(page, url) {
  /** @type {string[]} */
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.goto(url);
  await page.waitForFunction(() => {
    const px = window.__px;
    return !!px && (px.status === 'error' || px.status === 'unsupported' || (px.status === 'ok' && px.frames > 2));
  });
  const px = await page.evaluate(() => window.__px);
  return { px, errors };
}

/**
 * Holds keys, then waits until PATCH moved at least 1 m the right way (Q10 units in the HUD state).
 * @param {import('@playwright/test').Page} page
 * @param {string[]} keys
 * @param {number} sx expected sign of the x movement
 * @param {number} sy expected sign of the y movement
 */
async function drive(page, keys, sx, sy) {
  await page.waitForFunction(() => !!window.__px?.hud);
  const before = /** @type {Record<string, number>} */ (await page.evaluate(() => window.__px?.hud));
  for (const k of keys) await page.keyboard.down(k);
  await page.waitForFunction(
    ([x0, y0, sx, sy]) => {
      const h = window.__px?.hud;
      if (!h) return false;
      const okX = sx === 0 ? h.patchX === x0 : (h.patchX - x0) * sx > 1024;
      const okY = sy === 0 ? h.patchY === y0 : (h.patchY - y0) * sy > 1024;
      return okX && okY;
    },
    [before.patchX, before.patchY, sx, sy],
    { timeout: 10_000 },
  );
  for (const k of keys) await page.keyboard.up(k);
  const after = /** @type {Record<string, number>} */ (await page.evaluate(() => window.__px?.hud));
  expect(after.tick).toBeGreaterThan(before.tick);
  expect(after.entities).toBe(2); // PATCH and the run's bookkeeping entity
}

test('boots in the shared tier with WebGPU inside the engine worker; PATCH moves', async ({ page }) => {
  const { px, errors } = await boot(page, `/index.html?${POOLS}`);
  expect(px?.error ?? null).toBeNull();
  expect(px?.status).toBe('ok');
  expect(px?.probes.secure).toBe(true);
  expect(px?.probes.coi).toBe(true);
  expect(px?.threading).toBe('shared');
  expect(px?.engine?.adapter).toBeTruthy();
  expect(px?.engine?.jobWorkers).toBeGreaterThan(0);
  expect(px?.frames).toBeGreaterThan(2);
  await drive(page, ['KeyD'], 1, 0);
  await drive(page, ['ArrowUp', 'KeyA'], -1, 1);
  // The director's first waves arrive and PATCH's auto-fire (GPU-side targeting) kills some.
  await page.waitForFunction(() => (window.__px?.hud?.kills ?? 0) > 0 && (window.__px?.hud?.alive ?? 0) > 0, null, { timeout: 30_000 });
  await expect(page.locator('px-hud')).toContainText('PATCH');
  const bridge = await page.evaluate(() => window.__px?.bridge);
  expect(bridge?.dropped).toBe(0);
  expect(errors).toEqual([]);
});

for (const [driver, mode] of [
  ['ping', 'message-ping'],
  ['atomics', 'atomics-ping'],
  ['raf', 'worker-raf'],
]) {
  test(`runs with the ${mode} frame driver`, async ({ page }) => {
    const { px, errors } = await boot(page, `/index.html?driver=${driver}&${POOLS}`);
    expect(px?.status).toBe('ok');
    expect(px?.engine?.driver).toBe(mode);
    expect(px?.frames).toBeGreaterThan(2);
    await drive(page, ['KeyS'], 0, -1);
    expect(errors).toEqual([]);
  });
}

test('falls back to the transfer tier without cross-origin isolation; input and state go by message', async ({ page }) => {
  const { px, errors } = await boot(page, `http://127.0.0.1:${PORTS.noCoi}/index.html?${POOLS}`);
  expect(px?.probes.coi).toBe(false);
  expect(px?.threading).toBe('transfer');
  expect(px?.status).toBe('ok');
  await drive(page, ['KeyD', 'KeyW'], 1, 1);
  expect(errors).toEqual([]);
});
