// Device-loss recovery (docs/engine/03-rendering.md#device-loss): the engine's device is destroyed mid-run;
// the engine rebuilds the device, the GPU swarm and the renderer, logs a swarm reset, and the run goes on.
// The exported replay, reset included, must still reproduce every hash in Node on the JS reference swarm.
import { test, expect } from '@playwright/test';
import '../../engine/core/dev-global.js';
import { Replay } from '../../engine/app/replay.js';
import { EngineCommand } from '../../engine/app/sim-core.js';
import { UI_WORDS } from '../../engine/input/command-log.js';
import { SCRAPWAKE } from '../../game/app/game.js';

const POOLS = 'units=4096&shots=1024';

test('recovers from a device loss mid-run, and the replay with its swarm reset matches in Node', async ({ page }) => {
  test.setTimeout(180_000);
  /** @type {string[]} */
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.goto(`/index.html?${POOLS}`);
  await page.waitForFunction(() => window.__px?.status !== 'booting' && !!window.__px?.hud);
  expect(await page.evaluate(() => window.__px?.error ?? null)).toBeNull();
  await page.waitForFunction(() => (window.__px?.hud?.kills ?? 0) > 0 && (window.__px?.hud?.alive ?? 0) > 0, null, { timeout: 60_000 });

  await page.evaluate(() => window.__px?.loseDevice());
  await page.waitForFunction(() => window.__px?.device.recovered === 1 && window.__px?.device.state === 'ok', null, { timeout: 30_000 });
  const device = /** @type {{ tick: number, reason: string }} */ (await page.evaluate(() => window.__px?.device));
  expect(device.reason).toBe('destroyed');

  // The run goes on: two seconds of ticks after the reset, and the director has respawned the swarm.
  await page.waitForFunction((r) => (window.__px?.hud?.tick ?? 0) > r + 120 && (window.__px?.hud?.alive ?? 0) > 0, device.tick, { timeout: 60_000 });
  const img = await page.evaluate(async () => {
    const c = await /** @type {NonNullable<typeof window.__px>} */ (window.__px).capture();
    const cyan = c.palette['cyan-400'];
    let n = 0;
    for (let i = 0; i < c.data.length; i += 4) if (((c.data[i] << 16) | (c.data[i + 1] << 8) | c.data[i + 2]) === cyan) n++;
    return { cyan: n };
  });
  expect(img.cyan).toBeGreaterThan(0); // the rebuilt renderer draws the new swarm
  expect(await page.evaluate(() => window.__px?.status)).toBe('ok');

  const doc = /** @type {import('../../engine/app/replay.js').ReplayDocument} */ (await page.evaluate(() => window.__px?.exportReplay()));
  const resets = [];
  for (let i = 0; i < (doc.log.ui ?? []).length; i += UI_WORDS) if (doc.log.ui?.[i] === EngineCommand.SWARM_RESET) resets.push(i);
  expect(resets.length).toBe(1);
  const replayed = await Replay.run(SCRAPWAKE, doc);
  expect(replayed.mismatch).toBeNull();
  expect(replayed.ticks).toBe(doc.ticks);
  expect(errors).toEqual([]);
});
