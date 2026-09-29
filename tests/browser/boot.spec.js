import { test, expect } from '@playwright/test';
import { PORTS } from './playwright.config.js';

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

test('boots in the shared tier with WebGPU inside the engine worker', async ({ page }) => {
  const { px, errors } = await boot(page, '/index.html');
  expect(px?.error ?? null).toBeNull();
  expect(px?.status).toBe('ok');
  expect(px?.probes.secure).toBe(true);
  expect(px?.probes.coi).toBe(true);
  expect(px?.threading).toBe('shared');
  expect(px?.engine?.adapter).toBeTruthy();
  expect(px?.frames).toBeGreaterThan(2);
  expect(errors).toEqual([]);
});

test('boots with the message-ping frame driver', async ({ page }) => {
  const { px, errors } = await boot(page, '/index.html?driver=ping');
  expect(px?.status).toBe('ok');
  expect(px?.engine?.driver).toBe('message-ping');
  expect(px?.frames).toBeGreaterThan(2);
  expect(errors).toEqual([]);
});

test('falls back to the transfer tier without cross-origin isolation', async ({ page }) => {
  const { px, errors } = await boot(page, `http://127.0.0.1:${PORTS.noCoi}/index.html`);
  expect(px?.probes.coi).toBe(false);
  expect(px?.threading).toBe('transfer');
  expect(px?.status).toBe('ok');
  expect(errors).toEqual([]);
});
