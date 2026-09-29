// @ts-check
// The platform report (engine/app/platform-report.js, docs/engine/08-platforms.md): `?report` measures the
// machine and prints one row of the platform matrix, with a device-loss round trip in dev builds.
import { expect, test } from '@playwright/test';
import { REPORT_HEADER } from '../../engine/app/platform-report.js';

test('?report measures this machine and prints one platform-matrix row', async ({ page }) => {
  test.setTimeout(150_000);
  /** @type {string[]} */
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  await page.goto('/index.html?units=4096&shots=1024&pickups=512&report=4');
  await expect(page.locator('.report')).toContainText('Measuring this machine for 4 s');
  await page.waitForFunction(() => !!window.__px?.report, null, { timeout: 120_000 });
  const r = /** @type {Record<string, any>} */ (await page.evaluate(() => window.__px?.report));
  test.info().annotations.push({ type: 'row', description: r.row });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  expect(r.shell).toBe('browser');
  expect(r.browser).toMatch(/Chrom|HeadlessChrome/);
  expect(r.os).not.toBe('');
  expect(r.adapter.architecture).toBe('swiftshader');
  expect(r.coi).toBe(true);
  expect(r.threading).toBe('shared');
  expect(['worker-raf', 'message-ping', 'atomics-ping']).toContain(r.driver);
  expect(r.warmup.pipelines).toBeGreaterThanOrEqual(30);
  expect(r.readback.p95Ms).toBeGreaterThan(0);
  expect(r.readback.p99Ms).toBeGreaterThanOrEqual(r.readback.p95Ms);
  expect(r.readback.p99Ticks).toBeGreaterThan(0);
  expect(r.readback.K).toBe(4);
  if (r.features.includes('timestamp-query')) expect(r.swarmGpu.p95).toBeGreaterThan(0);
  expect(r.frameMs.p99).toBeGreaterThan(0);
  expect(r.deviceLoss).toMatchObject({ tested: true, recovered: true, reason: 'destroyed' });
  // One row of the "Measured" table: as many cells as the header.
  const cells = (/** @type {string} */ line) => line.split('|').length;
  expect(cells(r.row)).toBe(cells(REPORT_HEADER));
  expect(r.row).toContain('recovered in');
  await expect(page.locator('.report')).toContainText(r.row.slice(0, 40));
  await expect(page.locator('.report button')).toBeVisible();
  expect(await page.evaluate(() => window.__px?.status)).toBe('ok');
  expect(errors).toEqual([]);
});
