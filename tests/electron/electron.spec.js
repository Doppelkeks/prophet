import { test, expect, _electron as electron } from '@playwright/test';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
// PX_ELECTRON_ROOT=dist/web tests the production bundle; the default serves the repo root.
const pxRoot = process.env.PX_ELECTRON_ROOT ?? '.';

/**
 * Starts the Electron shell on the chosen root and waits until the engine runs.
 * @param {string} [query] extra URL parameters
 */
async function launch(query = '') {
  const app = await electron.launch({
    cwd: root,
    // --no-sandbox: CI containers run as root (tests only; the shipped app keeps the sandbox).
    // Small swarm pools keep SwiftShader fast (tests/browser/swarm.spec.js covers large scales).
    args: ['--no-sandbox', root, `--px-root=${pxRoot}`, `--px-query=units=4096&shots=1024&pickups=512${query}`],
    env: { ...process.env, PX_GPU_SWITCHES: process.env.PX_GPU_SWITCHES ?? 'swiftshader' },
  });
  const win = await app.firstWindow();
  await win.waitForFunction(
    () => {
      const px = window.__px;
      return !!px && (px.status === 'error' || px.status === 'unsupported' || (px.status === 'ok' && px.frames > 2));
    },
    null,
    { timeout: 90_000 },
  );
  return { app, win };
}

test('Electron shell: app:// origin, cross-origin isolated, WebGPU adapter, frames advance', async () => {
  const { app, win } = await launch();
  try {
    const px = await win.evaluate(() => window.__px);
    expect(px?.error ?? null).toBeNull();
    expect(px?.status).toBe('ok');
    expect(px?.probes.electron).toBe(true);
    expect(px?.probes.coi).toBe(true);
    expect(px?.threading).toBe('shared');
    expect(px?.engine?.adapter).toBeTruthy();
    expect(await win.evaluate(() => location.origin)).toBe('app://prophet');
    const headers = await win.evaluate(async () => {
      const r = await fetch('/index.html'); // exists in both roots (repo and dist/web)
      return {
        coop: r.headers.get('cross-origin-opener-policy'),
        coep: r.headers.get('cross-origin-embedder-policy'),
        corp: r.headers.get('cross-origin-resource-policy'),
      };
    });
    expect(headers).toEqual({ coop: 'same-origin', coep: 'require-corp', corp: 'same-origin' });
    // Input reaches the simulation and the HUD state comes back: hold D until PATCH moved 1 m east.
    await win.waitForFunction(() => !!window.__px?.hud);
    await win.keyboard.down('KeyD');
    await win.waitForFunction(() => (window.__px?.hud?.patchX ?? 0) > 1024, null, { timeout: 10_000 });
    await win.keyboard.up('KeyD');
    // The GPU swarm runs: waves spawn and PATCH's auto-fire kills units (targeting happens on the GPU).
    await win.waitForFunction(() => (window.__px?.hud?.kills ?? 0) > 0, null, { timeout: 30_000 });
    expect(await win.evaluate(() => window.__px?.status)).toBe('ok');
  } finally {
    await app.close();
  }
});

// M1 exit: device-loss recovery demonstrated in Electron too (docs/engine/03-rendering.md#device-loss). The
// production bundle compiles the loss hook out (DEV), so this runs on the repo root only.
test('Electron shell: recovers from a device loss, and the swarm and the renderer come back', async () => {
  test.skip(pxRoot !== '.', 'the production bundle has no device-loss hook');
  const { app, win } = await launch();
  try {
    await win.waitForFunction(() => (window.__px?.hud?.kills ?? 0) > 0 && (window.__px?.hud?.alive ?? 0) > 0, null, { timeout: 60_000 });
    await win.evaluate(() => window.__px?.loseDevice());
    await win.waitForFunction(() => window.__px?.device.recovered === 1 && window.__px?.device.state === 'ok', null, { timeout: 30_000 });
    const device = /** @type {{ tick: number, reason: string }} */ (await win.evaluate(() => window.__px?.device));
    expect(device.reason).toBe('destroyed');
    // Two seconds of ticks after the swarm reset, with a swarm again and more kills.
    const kills = /** @type {number} */ (await win.evaluate(() => window.__px?.hud?.kills ?? 0));
    await win.waitForFunction(
      ([t, k]) => (window.__px?.hud?.tick ?? 0) > t + 120 && (window.__px?.hud?.alive ?? 0) > 0 && (window.__px?.hud?.kills ?? 0) > k,
      [device.tick, kills],
      { timeout: 60_000 },
    );
    const img = await win.evaluate(async () => {
      const c = await /** @type {NonNullable<typeof window.__px>} */ (window.__px).capture();
      const cyan = c.palette['cyan-400'];
      let n = 0;
      for (let i = 0; i < c.data.length; i += 4) if (((c.data[i] << 16) | (c.data[i + 1] << 8) | c.data[i + 2]) === cyan) n++;
      return n;
    });
    expect(img, 'the rebuilt renderer draws the new swarm').toBeGreaterThan(0);
    expect(await win.evaluate(() => window.__px?.status)).toBe('ok');
  } finally {
    await app.close();
  }
});
