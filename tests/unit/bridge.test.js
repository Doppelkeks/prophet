// The main ↔ engine bridge: the SPSC input ring and the seqlocked UI state block, on real threads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { InputRing } from '../../engine/input/input-ring.js';
import { StateBlockReader, StateBlockWriter, StateSchema } from '../../engine/ui/state-block.js';

const WORKER = new URL('../support/bridge-worker.js', import.meta.url);

test('input ring: a producer thread and a consumer, in order, nothing lost, across wrap-around', { timeout: 30000 }, async () => {
  const capacity = 64;
  const count = 200000;
  const buffer = new SharedArrayBuffer(InputRing.bytes(capacity));
  const ring = new InputRing(new Int32Array(buffer), 0, capacity);
  ring.format();
  const worker = new Worker(WORKER, { workerData: { role: 'producer', buffer, capacity, count } });
  const done = new Promise((resolve, reject) => {
    worker.on('message', resolve);
    worker.on('error', reject);
  });
  let next = 0;
  let bad = 0;
  while (next < count) {
    ring.drain((kind, a, b, c) => {
      if (kind !== 1 || a !== next || b !== ~next || c !== Math.imul(next, 3)) bad++;
      next++;
    });
    if (next < count) await new Promise((r) => setImmediate(r));
  }
  await done;
  await worker.terminate();
  assert.equal(bad, 0);
  assert.equal(ring.pending, 0);
  assert.ok(ring.dropped > 0, 'the producer met a full ring and retried');
});

test('input ring: a full ring refuses and counts; capacity must be a power of two', () => {
  const ring = InputRing.create(4);
  for (let i = 0; i < 4; i++) assert.equal(ring.push(2, i), true);
  assert.equal(ring.push(2, 9), false);
  assert.equal(ring.dropped, 1);
  const seen = [];
  assert.equal(ring.drain((k, a) => seen.push(a)), 4);
  assert.deepEqual(seen, [0, 1, 2, 3]);
  assert.throws(() => InputRing.create(6), /power of two/);
});

test('state block: the reader never accepts a torn snapshot while a writer thread races it', { timeout: 30000 }, async () => {
  const fields = 64;
  const schema = new StateSchema(Object.fromEntries(Array.from({ length: fields }, (_, i) => [`f${i}`, 'i32'])));
  const buffer = new SharedArrayBuffer((fields + 16) * 4);
  const i32 = new Int32Array(buffer);
  const reader = new StateBlockReader(i32, 0, schema);
  const worker = new Worker(WORKER, { workerData: { role: 'writer', buffer, fields } });
  const done = new Promise((resolve, reject) => {
    worker.on('message', resolve);
    worker.on('error', reject);
  });
  let accepted = 0;
  let torn = 0;
  let last = 0;
  const until = Date.now() + 400;
  while (Date.now() < until) {
    const snap = reader.read();
    if (!snap) continue;
    accepted++;
    const v = snap[1];
    for (let w = 2; w <= fields; w++) if (snap[w] !== v) torn++;
    if (v < last) torn++; // snapshots never go back in time
    last = v;
  }
  Atomics.store(i32, fields + 8, 1);
  await done;
  await worker.terminate();
  assert.equal(torn, 0);
  assert.ok(accepted > 100 && last > 100, `the reader kept up (${accepted} snapshots, last value ${last})`);
});

test('state block: typed fields, and the detached reader of the transfer tier', () => {
  const schema = new StateSchema({ tick: 'u32', x: 'i32', fps: 'f32' });
  assert.deepEqual(schema.index, { tick: 1, x: 2, fps: 3 });
  const writer = new StateBlockWriter(new Int32Array(8), 0, schema);
  writer.begin();
  writer.set(schema.index.tick, 0xffffffff);
  writer.set(schema.index.x, -5);
  writer.set(schema.index.fps, 59.5);
  writer.end();
  const reader = StateBlockReader.detached(schema);
  assert.equal(reader.read(), reader.snap, 'an all-zero block is a valid (empty) snapshot');
  reader.receive(writer.copy());
  reader.read();
  assert.equal(reader.get(schema.index.tick), 0xffffffff);
  assert.equal(reader.get(schema.index.x), -5);
  assert.equal(reader.get(schema.index.fps), 59.5);
  writer.begin(); // odd seq: a reader of a block mid-write keeps its last good snapshot
  const mid = StateBlockReader.detached(schema);
  mid.receive(writer.copy());
  assert.equal(mid.read(), null);
  assert.throws(() => new StateSchema(Object.fromEntries(Array.from({ length: 1100 }, (_, i) => [`f${i}`, 'i32']))), /4 KiB/);
});
