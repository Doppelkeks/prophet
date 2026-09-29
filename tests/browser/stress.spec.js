// @ts-check
// The swarm stress scene at the `high` ceiling (docs/BUDGETS.md#stress-ceiling-scene-m2-exit): 100k units and
// a 50k shot pool under sustained churn. SwiftShader is far too slow for the 6 ms target, so this is a smoke
// run: no GPU errors, every block in order, zero event overflow, a full unit pool and a busy shot pool.
// The timings are attached to the report; real numbers come from `/tools/stress/` on real GPUs.
import { expect, test } from '@playwright/test';

test('stress scene: 100k units, 50k shots, zero event overflow, blocks in order', async ({ page }, info) => {
  test.setTimeout(240_000);
  /** @type {string[]} */
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/tools/stress/?units=100000&shots=50000&ticks=40&warm=8&timing=pass');
  await page.waitForFunction(() => /** @type {any} */ (window).__stress?.done, null, { timeout: 230_000, polling: 500 });
  const r = await page.evaluate(() => /** @type {any} */ (window).__stress);
  info.annotations.push({ type: 'stress', description: JSON.stringify({ gpu: r.gpu, wallMsPerTick: r.wallMsPerTick, readbackP95: r.readbackP95, compileMs: r.compileMs, maxShots: r.maxShots, maxEvents: r.maxEvents }) });
  expect(errors).toEqual([]);
  expect(r.errors).toEqual([]);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  expect(r.blocks).toBe(40);
  expect(r.inOrder).toBe(true);
  expect(r.eventOverflow, 'M2 exit: zero event overflow in stress scenes').toBe(0);
  expect(r.minAlive, 'the refill keeps the unit pool near full').toBeGreaterThan(90000);
  expect(r.maxShots).toBeGreaterThan(25000);
  expect(r.kills).toBeGreaterThan(0);
  expect(r.events).toBeGreaterThan(0);
  expect(r.scrapDropped).toBeGreaterThan(0);
  if (r.features.includes('timestamp-query')) expect(r.gpu.ticks).toBeGreaterThan(0);
});
