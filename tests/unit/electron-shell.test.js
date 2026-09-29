import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { AppProtocol } from '../../platforms/electron/protocol.js';
import { GpuSwitches } from '../../platforms/electron/gpu-switches.js';

const root = resolve(import.meta.dirname, '../..');

test('app:// protocol serves files with isolation headers, CSP and MIME types', async () => {
  const res = await AppProtocol.serve(root, 'app://prophet/game/app/engine-worker.js');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /javascript/);
  assert.equal(res.headers.get('cross-origin-opener-policy'), 'same-origin');
  assert.equal(res.headers.get('cross-origin-embedder-policy'), 'require-corp');
  assert.equal(res.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.match(res.headers.get('content-security-policy') ?? '', /default-src 'self'/);
  const index = await AppProtocol.serve(root, 'app://prophet/');
  assert.equal(index.status, 200);
  assert.match(await index.text(), /px-canvas/);
});

test('app:// protocol rejects traversal, unknown hosts and missing files', async () => {
  // The URL parser already folds (encoded) dot segments, so this stays inside the root: 404, not /etc/passwd.
  assert.equal((await AppProtocol.serve(root, 'app://prophet/%2e%2e/%2e%2e/etc/passwd')).status, 404);
  // Defense in depth: raw traversal that reaches the resolver is refused.
  assert.equal(AppProtocol.resolveInside('/srv/app', '/../etc/passwd'), null);
  assert.equal(AppProtocol.resolveInside('/srv/app', '/a/../../b'), null);
  assert.equal((await AppProtocol.serve(root, 'app://evil/index.html')).status, 404);
  assert.equal((await AppProtocol.serve(root, 'app://prophet/nope.js')).status, 404);
});

test('GPU switch sets: detection and a single merged enable-features switch', () => {
  assert.equal(GpuSwitches.detect('win32', 'arm64'), 'unsafe');
  assert.equal(GpuSwitches.detect('win32', 'x64'), 'none');
  assert.equal(GpuSwitches.detect('darwin', 'arm64'), 'none');
  /** @type {[string, string?][]} */
  const appended = [];
  const fakeApp = /** @type {any} */ ({ commandLine: { appendSwitch: (/** @type {string} */ n, /** @type {string=} */ v) => appended.push([n, v]) } });
  assert.equal(GpuSwitches.apply(fakeApp, { override: 'amd' }), 'amd');
  const names = appended.map(([n]) => n);
  assert.ok(names.includes('enable-unsafe-webgpu'));
  assert.equal(names.filter((n) => n === 'enable-features').length, 1);
  assert.deepEqual(appended.find(([n]) => n === 'enable-features'), ['enable-features', 'Vulkan,VulkanFromANGLE']);
  assert.deepEqual(appended.find(([n]) => n === 'ozone-platform'), ['ozone-platform', 'x11']);
  appended.length = 0;
  assert.equal(GpuSwitches.apply(fakeApp, { override: 'amd', alternate: true }), 'unsafe');
});
