import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ObliqueCamera } from '../../engine/render/oblique-camera.js';
import { PixelViewport } from '../../engine/render/pixel-viewport.js';

test('pixel viewport: the worked examples of docs/BUDGETS.md', () => {
  for (const [w, h, k, vw, vh] of [
    [1920, 1080, 4, 480, 270],
    [2560, 1440, 5, 512, 288],
    [3840, 2160, 8, 480, 270],
    [1280, 800, 3, 427, 267],
  ]) {
    const v = new PixelViewport().resize(w, h);
    assert.deepEqual([v.k, v.viewW, v.viewH], [k, vw, vh], `${w}x${h}`);
    assert.deepEqual([v.internalW, v.internalH], [vw + 4, vh + 4], 'a 2 px border on each side');
    assert.ok(v.cropX >= 0 && v.cropX < k && v.cropY >= 0 && v.cropY < k, 'overscan is below k and split evenly');
  }
  const small = new PixelViewport().resize(400, 200);
  assert.equal(small.k, 1, 'never below 1');
  assert.equal(new PixelViewport().resize(1920, 1080, 360).k, 3, 'zooming out lowers k');
});

test('oblique camera: tops and walls at the same pixel density, snapped to whole pixels', () => {
  const cam = new ObliqueCamera(8).follow(10.3, -2.07);
  const p = [0, 0];
  assert.deepEqual(cam.project(10.3 + 1, -2.07, 0, p).map((n) => Math.round((n - cam.project(10.3, -2.07, 0, [0, 0])[0]) * 1000) / 1000)[0], 8, '1 m along x is 8 px');
  const a = cam.project(0, 0, 0, [0, 0]);
  const b = cam.project(0, 1, 0, [0, 0]);
  const c = cam.project(0, 0, 1, [0, 0]);
  assert.equal(b[1] - a[1], 8, '1 m of depth along y is 8 px up');
  assert.equal(c[1] - a[1], 8, '1 m of height is 8 px up as well');
  assert.equal(cam.snapU, Math.floor(10.3 * 8));
  assert.equal(cam.snapV, Math.floor(-2.07 * 8));
  const [ou, ov] = cam.offset(4);
  assert.equal(ou, Math.round((10.3 * 8 - Math.floor(10.3 * 8)) * 4) / 4);
  assert.equal(ov, -Math.round((-2.07 * 8 - Math.floor(-2.07 * 8)) * 4) / 4);
  assert.ok(Math.abs(ou) <= 1 && Math.abs(ov) <= 1, 'the remainder is less than one internal pixel');
});

test('palette: the renderer reads the tokens of game/ui/palette.css, and the demo look uses only those', async () => {
  const { readFile } = await import('node:fs/promises');
  const { Renderer } = await import('../../engine/render/renderer.js');
  const { RENDER_STYLE } = await import('../../game/data/render-styles.js');
  const css = await readFile(new URL('../..' + RENDER_STYLE.palette, import.meta.url), 'utf8');
  const tokens = Renderer.parsePalette(css);
  assert.equal(tokens.size, 17);
  assert.equal(tokens.get('sodium-500'), 0xff7a1a, 'PATCH orange');
  assert.equal(tokens.get('cyan-400'), 0x19e6ff, 'Sweep cyan');
  const s = RENDER_STYLE;
  const used = [s.stunned, s.clear, s.ground.a, s.ground.b, s.ground.edge, s.ground.outside, ...[...s.units, ...s.actors, s.shot, s.pickup].flatMap((b) => [b.top, b.front])];
  for (const t of used) assert.ok(tokens.has(t), `--c-${t} is defined`);
});
