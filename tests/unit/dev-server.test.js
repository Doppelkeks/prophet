import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { DevServer } from '../../tools/dev-server.js';

const root = resolve(import.meta.dirname, '../..');
/** @type {DevServer} */
let coi;
/** @type {DevServer} */
let plain;

before(async () => {
  coi = new DevServer({ root, port: 0, coi: true, watch: false, log: false });
  plain = new DevServer({ root, port: 0, coi: false, watch: false, log: false });
  await coi.start();
  await plain.start();
});

after(async () => {
  await coi.stop();
  await plain.stop();
});

test('serves files with COOP/COEP/CORP and the right MIME types', async () => {
  const html = await fetch(`http://127.0.0.1:${coi.port}/index.html`);
  assert.equal(html.status, 200);
  assert.match(html.headers.get('content-type') ?? '', /text\/html/);
  assert.equal(html.headers.get('cross-origin-opener-policy'), 'same-origin');
  assert.equal(html.headers.get('cross-origin-embedder-policy'), 'require-corp');
  assert.equal(html.headers.get('cross-origin-resource-policy'), 'same-origin');
  const js = await fetch(`http://127.0.0.1:${coi.port}/game/app/engine-worker.js`);
  assert.match(js.headers.get('content-type') ?? '', /javascript/);
  assert.equal(js.headers.get('cross-origin-embedder-policy'), 'require-corp');
});

test('directory requests serve index.html', async () => {
  const res = await fetch(`http://127.0.0.1:${coi.port}/`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /<canvas id="px-canvas">/);
});

test('--no-coi omits the isolation headers', async () => {
  const res = await fetch(`http://127.0.0.1:${plain.port}/index.html`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cross-origin-embedder-policy'), null);
});

test('rejects path traversal and returns 404 for missing files', async () => {
  assert.equal(DevServer.resolveInside('/srv/app', '/../etc/passwd'), null);
  assert.equal(DevServer.resolveInside('/srv/app', '/a/../../x'), null);
  assert.equal(DevServer.resolveInside('/srv/app', '/ok/file.js'), '/srv/app/ok/file.js');
  const missing = await fetch(`http://127.0.0.1:${coi.port}/does-not-exist.js`);
  assert.equal(missing.status, 404);
});
