import { test, expect } from '@playwright/test';
import '../../engine/core/dev-global.js';
import { Heap } from '../../engine/core/heap.js';
import { JobSystem } from '../../engine/jobs/job-system.js';
import { testRegistry } from '../support/test-kernels.js';
import { JobScenario } from '../support/job-scenario.js';
import { PORTS } from './playwright.config.js';

/** The scenario's hash from an inline run in this (Node) process: every browser tier must match it. */
async function expectedHash() {
  const jobs = await JobSystem.create({ tier: 'inline', heap: Heap.create('test', false), registry: testRegistry() });
  return JobScenario.run(jobs);
}

/** @param {import('@playwright/test').Page} page @param {string} origin */
async function open(page, origin) {
  /** @type {string[]} */
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  await page.goto(`${origin}/tests/browser/pages/jobs.html`);
  await page.waitForFunction(() => /** @type {any} */ (window).__jobsReady === true);
  return errors;
}

/** @param {import('@playwright/test').Page} page @param {string} tier @param {number} workers */
function runJobs(page, tier, workers) {
  return page.evaluate(([t, w]) => /** @type {any} */ (window).runJobs(t, w), /** @type {const} */ ([tier, workers]));
}

test('the shared tier with nested job workers matches every other tier', async ({ page }) => {
  const expected = await expectedHash();
  const errors = await open(page, '');
  for (const [tier, workers] of /** @type {const} */ ([
    ['inline', 0],
    ['shared', 0],
    ['shared', 2],
    ['shared', 4],
    ['transfer', 2],
  ])) {
    const r = await runJobs(page, tier, workers);
    expect(r.error ?? null, `${tier}/${workers}`).toBeNull();
    expect(r.coi).toBe(true);
    expect(r.shared).toBe(tier === 'shared');
    expect(r.jobErrors).toEqual([]);
    expect(r.hash, `${tier}/${workers}`).toBe(expected);
    test.info().annotations.push({ type: `${tier}/${workers}`, description: `${r.ms.toFixed(1)} ms` });
  }
  expect(errors).toEqual([]);
});

test('without cross-origin isolation the transfer tier still matches', async ({ page }) => {
  const expected = await expectedHash();
  const errors = await open(page, `http://127.0.0.1:${PORTS.noCoi}`);
  const shared = await runJobs(page, 'shared', 2);
  expect(shared.coi).toBe(false);
  expect(shared.error, 'the shared tier is refused').toBeTruthy();
  for (const [tier, workers] of /** @type {const} */ ([
    ['transfer', 2],
    ['transfer', 0],
    ['inline', 0],
  ])) {
    const r = await runJobs(page, tier, workers);
    expect(r.error ?? null, `${tier}/${workers}`).toBeNull();
    expect(r.hash, `${tier}/${workers}`).toBe(expected);
  }
  expect(errors).toEqual([]);
});
