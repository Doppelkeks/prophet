import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../../engine/core/rng.js';
import { Hash32 } from '../../engine/core/hash32.js';
import { TestRandom } from '../support/vectors.js';

const M32 = 0xffffffffn;
/** Independent BigInt implementation of lowbias32. @param {number} v */
function refMix32(v) {
  let x = BigInt(v >>> 0);
  x ^= x >> 16n;
  x = (x * 0x7feb352dn) & M32;
  x ^= x >> 15n;
  x = (x * 0x846ca68bn) & M32;
  x ^= x >> 16n;
  return Number(x);
}

test('mix32 equals the BigInt reference of lowbias32', () => {
  const rnd = new TestRandom(10);
  assert.equal(Rng.mix32(0), 0);
  for (let i = 0; i < 20000; i++) {
    const x = rnd.u32();
    assert.equal(Rng.mix32(x), refMix32(x));
  }
});

test('streams are pinned, deterministic and well separated', () => {
  // Pinned: changing the RNG invalidates every replay and daily seed.
  const key = Rng.key(12345, 7);
  assert.equal(Rng.u32(key, 100, 3), Rng.u32(key, 100, 3));
  const pinned = [Rng.key(0, 0), Rng.key(1, 2), Rng.u32(Rng.key(1, 2), 3, 4)];
  assert.deepEqual(pinned, [refMix32((0 ^ Math.imul(1, 0x9e3779b9)) >>> 0), refMix32((1 ^ Math.imul(3, 0x9e3779b9)) >>> 0), refMix32((refMix32((Rng.key(1, 2) ^ 3) >>> 0) ^ 4) >>> 0)]);
  const seen = new Set();
  for (let tick = 0; tick < 200; tick++) for (let id = 0; id < 500; id++) seen.add(Rng.u32(key, tick, id));
  assert.ok(seen.size > 99990, `too many collisions: ${100000 - seen.size}`);
});

test('below stays in range and equals the exact multiply-high', () => {
  const rnd = new TestRandom(11);
  for (let i = 0; i < 20000; i++) {
    const h = rnd.u32(), n = (rnd.u32() >>> rnd.below(32)) + 1;
    const v = Rng.below(h, n);
    assert.ok(v >= 0 && v < n);
    assert.equal(v, Number((BigInt(h) * BigInt(n)) >> 32n));
  }
  assert.equal(Rng.chance(0xffffffff, 0), false);
  assert.equal(Rng.chance(0xffffffff, 65536), true);
  assert.equal(Rng.chance(0, 1), true);
});

test('Hash32 matches published MurmurHash3 x86_32 vectors', () => {
  const empty = new Uint32Array(0);
  assert.equal(Hash32.words(empty, 0, 0, 0), 0);
  assert.equal(Hash32.words(empty, 0, 0, 1), 0x514e28b7);
  assert.equal(Hash32.words(empty, 0, 0, 0xffffffff), 0x81f16f39);
  // "test" as one little-endian word.
  assert.equal(Hash32.words(Uint32Array.of(0x74736574), 0, 1, 0), 0xba6bd213);
});

test('Hash32 is order-sensitive', () => {
  const a = Hash32.words(Uint32Array.of(1, 2, 3), 0, 3);
  const b = Hash32.words(Uint32Array.of(3, 2, 1), 0, 3);
  assert.notEqual(a, b);
  assert.equal(a, Hash32.words(Int32Array.of(1, 2, 3), 0, 3));
});
