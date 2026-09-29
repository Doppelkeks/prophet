// The outbound path without garbage (docs/engine/05-gpu-swarm.md#k-latency-and-stalls): the block ring copies
// blocks out of mapped slots into pooled blocks, the readback ring hands out the mapped range itself, and
// events sort in place in O(n log n) into the same canonical order as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BlockRing } from '../../engine/swarm/block-ring.js';
import { SwarmOutbound } from '../../engine/swarm/swarm-contract.js';
import { EVENT_WORDS, OH, OUT_MAGIC, SwarmLayout } from '../../engine/swarm/swarm-layout.js';

const layout = new SwarmLayout({ units: 256, shots: 64, pickups: 64, groups: 8, fires: 32, proxies: 4, gridW: 32, arenaHalf: 32 * 1024, events: 16 });
const L = layout.L;

/** A slot of `k` blocks for ticks t0.., with `events[i]` event records in block i (random words). */
function slot(/** @type {number} */ t0, /** @type {number[]} */ events, seed = 1) {
  const words = new Int32Array(L.outWords * events.length);
  let x = seed;
  for (let i = 0; i < events.length; i++) {
    const at = i * L.outWords;
    for (let w = 0; w < L.oEvents; w++) words[at + w] = (x = (Math.imul(x, 1103515245) + 12345) | 0);
    words[at + OH.MAGIC] = OUT_MAGIC;
    words[at + OH.TICK] = t0 + i;
    words[at + OH.EVENTS] = events[i];
    for (let w = 0; w < Math.min(events[i], L.eventCap) * EVENT_WORDS; w++) words[at + L.oEvents + w] = (x = (Math.imul(x, 1103515245) + 12345) | 0);
  }
  return words;
}

test('block ring: a copied block equals the GPU block, stale events of a reused block are zeroed', () => {
  const ring = new BlockRing(layout, 4);
  const a = slot(0, [9]);
  const b0 = ring.put(0, a, 0);
  assert.deepEqual(b0, a.subarray(0, L.outWords));
  assert.equal(ring.take(0), b0);
  const b = slot(1, [2, 40], 7); // 40 events: more than the cap of 16, which the header still reports
  const b1 = ring.put(1, b, 0);
  assert.equal(ring.take(1), b1, 'block 0 goes back to the pool at this take');
  const b2 = ring.put(2, b, L.outWords);
  assert.equal(b2, b0, 'the pooled block is reused');
  assert.deepEqual(b2, b.subarray(L.outWords, 2 * L.outWords));
  const c = slot(3, [3], 9);
  ring.take(2);
  const b3 = ring.put(3, c, 0); // reuses block 1, which held 2 events: nothing stale beyond 3
  assert.deepEqual(b3, c.subarray(0, L.outWords));
  ring.take(3);
  const d = slot(4, [1], 11);
  const b4 = ring.put(4, d, 0); // reuses block 0, which held 16 records: records 1..15 must be zero now
  assert.deepEqual(b4, d.subarray(0, L.outWords));
  assert.equal(ring.allocated, 2);
});

test('block ring: missing and repeated ticks, overflow, and no allocation in a steady run', () => {
  const ring = new BlockRing(layout, 3);
  assert.equal(ring.take(5), null, 'not arrived');
  const s = slot(0, [0, 0, 0]);
  for (let k = 0; k < 3; k++) ring.put(k, s, k * L.outWords);
  assert.throws(() => ring.put(4, s, 0), /block ring full at tick 4: tick 0 was never taken/);
  assert.equal(ring.take(1)?.[OH.TICK], 1, 'any order');
  assert.equal(ring.take(1), null, 'a block is taken once');
  assert.equal(ring.pending, 2);
  // The engine's pattern: harvest up to K blocks ahead, take one per tick.
  const steady = new BlockRing(layout, 24);
  const one = slot(0, [3]);
  let taken = 0;
  for (let t = 0; t < 1000; t++) {
    one[OH.TICK] = t;
    steady.put(t, one, 0);
    if (t >= 4) assert.equal(steady.take(taken++)?.[OH.TICK], taken - 1);
  }
  assert.ok(steady.allocated <= 6, `${steady.allocated} blocks for 1000 ticks`);
});

/** The canonicalization of increment 11: an insertion sort, kept as the reference order. */
function insertionSort(/** @type {Int32Array} */ block) {
  const n = Math.min(block[OH.EVENTS], L.eventCap);
  const base = L.oEvents;
  const after = (/** @type {number} */ at, /** @type {number[]} */ a) => {
    for (let w = 0; w < 4; w++) if (block[at + w] !== a[w]) return block[at + w] >>> 0 > a[w] >>> 0;
    return false;
  };
  for (let i = 1; i < n; i++) {
    const a = [0, 1, 2, 3].map((w) => block[base + i * 4 + w]);
    let j = i - 1;
    while (j >= 0 && after(base + j * 4, a)) {
      block.copyWithin(base + (j + 1) * 4, base + j * 4, base + (j + 1) * 4);
      j--;
    }
    for (let w = 0; w < 4; w++) block[base + (j + 1) * 4 + w] = a[w];
  }
  return block;
}

test('canonicalize: the heap sort gives the insertion sort order, for any input order', () => {
  let x = 42;
  const rnd = () => (x = (Math.imul(x, 1103515245) + 12345) | 0);
  /** @type {[string, (i: number, w: number) => number][]} */
  const shapes = [
    ['random', () => rnd()],
    ['few values (ties on the first words)', (i, w) => (w < 3 ? rnd() & 3 : rnd())],
    ['duplicates', (i) => (i % 3) * 0x10001],
    ['sorted', (i, w) => (w === 0 ? i : 0)],
    ['reversed', (i, w) => (w === 0 ? 1000 - i : 0)],
    ['negative words (unsigned order)', (i, w) => (w === 1 ? -i : 7)],
  ];
  for (const [name, word] of shapes) {
    for (const n of [0, 1, 2, 3, 5, 15, 16, 40]) {
      const block = new Int32Array(L.outWords);
      block[OH.MAGIC] = OUT_MAGIC;
      block[OH.EVENTS] = n;
      for (let i = 0; i < Math.min(n, L.eventCap); i++) for (let w = 0; w < 4; w++) block[L.oEvents + i * 4 + w] = word(i, w);
      const expected = insertionSort(block.slice());
      assert.deepEqual(SwarmOutbound.canonicalize(layout, block), expected, `${name}, ${n} events`);
    }
  }
});

test('canonicalize sorts a full 8192-event buffer (the high profile) in place', () => {
  const big = new SwarmLayout({ units: 256, shots: 64, pickups: 64, groups: 8, fires: 32, proxies: 4, gridW: 32, arenaHalf: 32 * 1024, events: 8192 });
  const block = new Int32Array(big.L.outWords);
  block[OH.MAGIC] = OUT_MAGIC;
  block[OH.EVENTS] = 9000; // overflowed: only the cap is present
  let x = 5;
  for (let w = 0; w < 8192 * 4; w++) block[big.L.oEvents + w] = x = (Math.imul(x, 1103515245) + 12345) | 0;
  const t0 = performance.now();
  SwarmOutbound.canonicalize(big, block);
  const ms = performance.now() - t0;
  for (let i = 1; i < 8192; i++) {
    const a = big.L.oEvents + (i - 1) * 4;
    const b = a + 4;
    let ok = true;
    for (let w = 0; w < 4; w++) {
      if (block[a + w] !== block[b + w]) {
        ok = block[a + w] >>> 0 < block[b + w] >>> 0;
        break;
      }
    }
    assert.ok(ok, `record ${i} is out of order`);
  }
  assert.ok(ms < 250, `${ms.toFixed(1)} ms (a heap sort takes ~2 ms here; the old insertion sort ~330 ms)`);
});
