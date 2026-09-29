// The tech demo end to end: scripted play in the browser on the GPU swarm (stress keys included), then the
// exported replay runs here in Node on the JS reference swarm and must reproduce every state hash.
import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import '../../engine/core/dev-global.js';
import { Replay } from '../../engine/app/replay.js';
import { SCRAPWAKE } from '../../game/app/game.js';
import { UiCommand } from '../../game/data/ui-commands.js';
import { UI_WORDS } from '../../engine/input/command-log.js';

const POOLS = 'units=4096&shots=1024&pickups=512';

/**
 * @param {import('@playwright/test').Page} page
 * @param {(h: Record<string, number>) => boolean} pred
 * @param {number} [timeout]
 */
async function until(page, pred, timeout = 30_000) {
  await page.waitForFunction(`(${pred})(window.__px?.hud ?? {})`, null, { timeout });
}

/** @param {import('@playwright/test').Page} page @param {string} key @param {number} ms */
async function hold(page, key, ms) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

test('scripted play on the GPU swarm replays identically in Node on the JS reference', async ({ page }, info) => {
  test.setTimeout(240_000);
  /** @type {string[]} */
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.goto(`/index.html?${POOLS}`);
  await page.waitForFunction(() => window.__px?.status !== 'booting' && !!window.__px?.hud);
  expect(await page.evaluate(() => window.__px?.error ?? null)).toBeNull();
  expect(await page.evaluate(() => window.__px?.engine?.swarm?.backend)).toBe('gpu');
  await expect(page.locator('px-hud')).toContainText('swarm gpu 4096/1024');

  // Stress up twice: waves now spawn three times their base count.
  await page.keyboard.press('Equal');
  await page.keyboard.press('Equal');
  await until(page, (h) => h.stress === 2);
  // Stand still until the swarm reaches PATCH.
  await until(page, (h) => h.hp < h.hpMax || h.downs > 0, 90_000);
  // A burst ring, then strafe a square.
  const alive = /** @type {number} */ (await page.evaluate(() => window.__px?.hud?.alive));
  await page.keyboard.press('BracketRight');
  await until(page, (h) => h.alive > 0 && h.waves > 0);
  for (const key of ['KeyD', 'KeyW', 'KeyA', 'KeyS']) await hold(page, key, 1500);
  await page.keyboard.press('Minus');
  await until(page, (h) => h.stress === 1 && h.kills > 0);
  const hud = /** @type {Record<string, number>} */ (await page.evaluate(() => window.__px?.hud));
  info.annotations.push({ type: 'run', description: `tick ${hud.tick}, kills ${hud.kills}, alive ${hud.alive} (${alive} before the burst), hp ${hud.hp / 256}, downs ${hud.downs}` });
  await info.attach('demo.png', { body: await page.screenshot(), contentType: 'image/png' });

  const doc = /** @type {import('../../engine/app/replay.js').ReplayDocument} */ (await page.evaluate(() => window.__px?.exportReplay()));
  const path = info.outputPath('replay.json');
  await writeFile(path, JSON.stringify(doc));
  await info.attach('replay.json', { path, contentType: 'application/json' });
  expect(doc.swarmCaps?.units).toBe(4096);
  expect(doc.hashes.length).toBeGreaterThanOrEqual(2 * 3); // at least three hashes, one every 60 ticks
  const codes = [];
  for (let i = 0; i < (doc.log.ui ?? []).length; i += UI_WORDS) codes.push(doc.log.ui?.[i]);
  expect(codes).toEqual([UiCommand.STRESS_UP, UiCommand.STRESS_UP, UiCommand.BURST, UiCommand.STRESS_DOWN]);

  const replayed = await Replay.run(SCRAPWAKE, doc);
  expect(replayed.mismatch).toBeNull();
  expect(replayed.ticks).toBe(doc.ticks);
  expect(replayed.hashes).toEqual(doc.hashes);
  expect(errors).toEqual([]);
});
