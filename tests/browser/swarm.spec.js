// The GPU swarm must reproduce the JS reference bit for bit (docs/engine/05-gpu-swarm.md#testing), for
// any workgroup size, and blocks must come back through the readback ring in order.
import { test, expect } from '@playwright/test';

/** @param {import('@playwright/test').Page} page */
async function open(page) {
  /** @type {string[]} */
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  await page.goto('/tests/browser/pages/swarm.html');
  await page.waitForFunction(() => /** @type {any} */ (window).__swarmReady === true);
  return errors;
}

const SMALL = { units: 2048, shots: 512, fires: 32, groups: 16, proxies: 4, gridW: 64, arenaHalf: 64 * 1024 };

for (const wg of [32, 64, 128]) {
  test(`GPU equals reference on every tick: 2k units × 300 ticks, workgroup size ${wg}`, async ({ page }) => {
    test.setTimeout(240_000);
    const errors = await open(page);
    const r = await page.evaluate((cfg) => /** @type {any} */ (window).runSwarm(cfg), { scene: 'mixed', caps: SMALL, ticks: 300, wg, seed: 99 });
    test.info().annotations.push({ type: 'result', description: JSON.stringify(r) });
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
    expect(r.kills).toBeGreaterThan(0);
    expect(r.scrapCollected).toBeGreaterThan(0); // drops, merged gems and magnets ran on both sides
    expect(r.errors).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('GPU equals reference when drops overflow a 16-slot pickup pool (the scrap carry and merged gems)', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await open(page);
  const r = await page.evaluate((cfg) => /** @type {any} */ (window).runSwarm(cfg), { scene: 'mixed', caps: { ...SMALL, pickups: 16 }, ticks: 300, wg: 64, seed: 3 });
  test.info().annotations.push({ type: 'result', description: JSON.stringify(r) });
  expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
  expect(r.maxCarry).toBeGreaterThan(0); // drops found no free slot and waited in the carry
  expect(r.scrapCollected).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('GPU equals reference at 100k units × 5 ticks', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = await open(page);
  const caps = { units: 100000, shots: 4096, fires: 64, groups: 64, proxies: 4, gridW: 128, arenaHalf: 64 * 1024 };
  const r = await page.evaluate((cfg) => /** @type {any} */ (window).runSwarm(cfg), { scene: 'big', caps, ticks: 5, wg: 64, seed: 7 });
  test.info().annotations.push({ type: 'result', description: JSON.stringify(r) });
  expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
  expect(r.maxAlive).toBeGreaterThan(90000);
  expect(errors).toEqual([]);
});

test('readback ring: blocks arrive in submission order, identical to the reference', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = await open(page);
  const r = await page.evaluate((cfg) => /** @type {any} */ (window).runReadback(cfg), { ticks: 120, seed: 5 });
  test.info().annotations.push({ type: 'readback', description: JSON.stringify(r) });
  expect(r.received).toBe(120);
  expect(r.inOrder).toBe(true);
  expect(r.mismatches).toBe(0);
  expect(r.p95).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
