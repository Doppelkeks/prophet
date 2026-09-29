import { test, expect, _electron as electron } from '@playwright/test';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
// PX_ELECTRON_ROOT=dist/web tests the production bundle; the default serves the repo root.
const pxRoot = process.env.PX_ELECTRON_ROOT ?? '.';

test('Electron shell: app:// origin, cross-origin isolated, WebGPU adapter, frames advance', async () => {
  const app = await electron.launch({
    cwd: root,
    // --no-sandbox: CI containers run as root (tests only; the shipped app keeps the sandbox).
    args: ['--no-sandbox', root, `--px-root=${pxRoot}`],
    env: { ...process.env, PX_GPU_SWITCHES: process.env.PX_GPU_SWITCHES ?? 'swiftshader' },
  });
  try {
    const win = await app.firstWindow();
    await win.waitForFunction(
      () => {
        const px = window.__px;
        return !!px && (px.status === 'error' || px.status === 'unsupported' || (px.status === 'ok' && px.frames > 2));
      },
      null,
      { timeout: 90_000 },
    );
    const px = await win.evaluate(() => window.__px);
    expect(px?.error ?? null).toBeNull();
    expect(px?.status).toBe('ok');
    expect(px?.probes.electron).toBe(true);
    expect(px?.probes.coi).toBe(true);
    expect(px?.threading).toBe('shared');
    expect(px?.engine?.adapter).toBeTruthy();
    expect(await win.evaluate(() => location.origin)).toBe('app://prophet');
    const headers = await win.evaluate(async () => {
      const r = await fetch('/game/app/engine-worker.js');
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
  } finally {
    await app.close();
  }
});
