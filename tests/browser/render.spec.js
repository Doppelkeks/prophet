import { test, expect } from '@playwright/test';

/** Small swarm pools keep SwiftShader fast; swarm.spec.js covers the large scales. */
const POOLS = 'units=4096&shots=1024';

/**
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
    return !!px && (px.status === 'error' || px.status === 'unsupported' || (px.status === 'ok' && px.frames > 2 && !!px.hud));
  });
  const px = await page.evaluate(() => window.__px);
  expect(px?.error ?? null).toBeNull();
  expect(px?.status).toBe('ok');
  return errors;
}

/**
 * Captures the engine's internal image and summarizes it in the page: PATCH's orange near the screen
 * center, the Sweep's cyan anywhere, the ground's checker colors, and the camera. Also returns a PNG.
 * @param {import('@playwright/test').Page} page
 */
async function look(page) {
  return page.evaluate(async () => {
    const px = /** @type {NonNullable<typeof window.__px>} */ (window.__px);
    const img = await px.capture();
    const { width: w, height: h, data, view, palette } = img;
    const rgb = (/** @type {number} */ i) => (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    const count = (/** @type {number} */ hex, x0 = 0, y0 = 0, x1 = w, y1 = h) => {
      let n = 0;
      for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) {
        for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) if (rgb((y * w + x) * 4) === hex) n++;
      }
      return n;
    };
    // The camera point sits at column halfW and at the row whose bottom edge is v = 0.
    const cx = view.halfW;
    const cy = h - view.halfH;
    const canvas = new OffscreenCanvas(w, h);
    const ctx = /** @type {OffscreenCanvasRenderingContext2D} */ (canvas.getContext('2d'));
    ctx.putImageData(new ImageData(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), w, h), 0, 0);
    const png = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
    return {
      width: w,
      height: h,
      tick: img.tick,
      view,
      hud: px.hud,
      orangeCenter: count(palette['sodium-500'], cx - 16, cy - 24, cx + 16, cy + 16),
      orange: count(palette['sodium-500']),
      cyan: count(palette['cyan-400']),
      groundA: count(palette['night-800']),
      groundB: count(palette['night-700']),
      png: Array.from(png),
    };
  });
}

test('renders PATCH at the center and the swarm in cyan, and the camera follows PATCH', async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const errors = await boot(page, `/index.html?${POOLS}`);
  const engine = await page.evaluate(() => window.__px?.engine);
  expect(engine?.render).toEqual({ k: 3, width: 427 + 4, height: 240 + 4 }); // 720 / 270 → k = 3, plus the border

  // The first waves spawn around PATCH (the director's ring) and draw as cyan-topped boxes.
  await page.waitForFunction(() => (window.__px?.hud?.alive ?? 0) >= 20, null, { timeout: 30_000 });
  const a = await look(page);
  await info.attach('internal-start.png', { body: Buffer.from(a.png), contentType: 'image/png' });
  expect(a.width).toBe(431);
  expect(a.height).toBe(244);
  expect(a.orangeCenter).toBeGreaterThanOrEqual(12); // PATCH's optic, at the screen center
  expect(a.cyan).toBeGreaterThan(20);
  expect(a.groundA).toBeGreaterThan(1000);
  expect(a.groundB).toBeGreaterThan(1000);

  // Drive east for 4 m: the camera follows, PATCH stays at the center.
  const x0 = /** @type {number} */ (a.hud?.patchX);
  await page.keyboard.down('KeyD');
  await page.waitForFunction((x) => (window.__px?.hud?.patchX ?? x) - x > 4 * 1024, x0, { timeout: 15_000 });
  await page.keyboard.up('KeyD');
  await page.waitForTimeout(300); // let PATCH stop, so the capture and the HUD agree
  const b = await look(page);
  await info.attach('internal-moved.png', { body: Buffer.from(b.png), contentType: 'image/png' });
  const dxPx = ((/** @type {number} */ (b.hud?.patchX) - x0) / 1024) * 8;
  expect(Math.abs(b.view.snapU - a.view.snapU - dxPx)).toBeLessThanOrEqual(3);
  expect(b.orangeCenter).toBeGreaterThanOrEqual(12);

  // A resize to 1080p reallocates the targets: k = 4, 480 × 270 plus the border.
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect.poll(async () => (await look(page)).width, { timeout: 10_000 }).toBe(484);
  const c = await look(page);
  expect(c.height).toBe(274);
  expect(c.view.k).toBe(4);
  expect(c.orangeCenter).toBeGreaterThanOrEqual(12);
  await info.attach('canvas-1080p.png', { body: await page.screenshot(), contentType: 'image/png' });
  expect(errors).toEqual([]);
});

test('draws the JS reference swarm too (?swarm=cpu)', async ({ page }) => {
  const errors = await boot(page, '/index.html?swarm=cpu');
  expect(await page.evaluate(() => window.__px?.engine?.swarm?.backend)).toBe('cpu');
  await page.waitForFunction(() => (window.__px?.hud?.alive ?? 0) >= 20, null, { timeout: 30_000 });
  const a = await look(page);
  expect(a.cyan).toBeGreaterThan(20);
  expect(a.orangeCenter).toBeGreaterThanOrEqual(12);
  expect(errors).toEqual([]);
});
