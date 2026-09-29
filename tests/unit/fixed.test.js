import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Fixed } from '../../engine/core/fixed.js';
import { SIN_TABLE_HASH, SIN_TABLE_Q14, SIN_TABLE_SIZE } from '../../engine/core/sin-table.js';
import { EDGE_I32, TestRandom } from '../support/vectors.js';

const refMulShr = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ s) =>
  Number(BigInt.asIntN(32, (BigInt(a) * BigInt(b)) >> BigInt(s)));
const refMulHi = (/** @type {number} */ a, /** @type {number} */ b) => Number((BigInt(a >>> 0) * BigInt(b >>> 0)) >> 32n);
const refIsqrt = (/** @type {number} */ n) => {
  let r = Math.floor(Math.sqrt(n));
  while (r * r > n) r--;
  while ((r + 1) * (r + 1) <= n) r++;
  return r;
};

test('the sine table is pinned and has the expected landmarks', () => {
  assert.equal(SIN_TABLE_Q14.length, SIN_TABLE_SIZE);
  let hash = 0x811c9dc5;
  for (const byte of new Uint8Array(SIN_TABLE_Q14.buffer)) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  assert.equal(hash, SIN_TABLE_HASH, 'sin-table.js changed: regenerate deliberately and update replays');
  assert.equal(Fixed.sinB(0), 0);
  assert.equal(Fixed.sinB(16384), 16384);
  assert.equal(Fixed.sinB(32768), 0);
  assert.equal(Fixed.sinB(49152), -16384);
  assert.equal(Fixed.cosB(0), 16384);
  assert.equal(Fixed.sinB(65536 + 16384), 16384, 'only the low 16 bits of the angle matter');
  assert.equal(Fixed.sinB(-16384), -16384, 'negative angles wrap');
  for (let a = 0; a < 65536; a += 16) assert.equal(Fixed.sinB((65536 - a) & 0xffff), -Fixed.sinB(a) | 0);
});

test('mulShr equals the exact BigInt result for edge and random values', () => {
  const shifts = [0, 1, 8, 10, 14, 16, 24, 31];
  for (const a of EDGE_I32) for (const b of EDGE_I32) for (const s of shifts) {
    assert.equal(Fixed.mulShr(a, b, s), refMulShr(a, b, s), `mulShr(${a}, ${b}, ${s})`);
  }
  const rnd = new TestRandom(1);
  for (let i = 0; i < 50000; i++) {
    const a = rnd.i32(), b = rnd.i32(), s = rnd.below(32);
    assert.equal(Fixed.mulShr(a, b, s), refMulShr(a, b, s), `mulShr(${a}, ${b}, ${s})`);
  }
});

test('mulHiU32 equals the exact BigInt high word', () => {
  const rnd = new TestRandom(2);
  for (const a of EDGE_I32) for (const b of EDGE_I32) assert.equal(Fixed.mulHiU32(a, b), refMulHi(a, b));
  for (let i = 0; i < 50000; i++) {
    const a = rnd.u32(), b = rnd.u32();
    assert.equal(Fixed.mulHiU32(a, b), refMulHi(a, b));
  }
});

test('isqrt is floor(sqrt(n)) exhaustively over 20 bits and on random u32', () => {
  for (let n = 0; n < 1 << 20; n++) {
    const r = Fixed.isqrt(n);
    if (r * r > n || (r + 1) * (r + 1) <= n) assert.fail(`isqrt(${n}) = ${r}`);
  }
  assert.equal(Fixed.isqrt(0xffffffff), 65535);
  const rnd = new TestRandom(3);
  for (let i = 0; i < 100000; i++) {
    const n = rnd.u32();
    assert.equal(Fixed.isqrt(n), refIsqrt(n), `isqrt(${n})`);
  }
});

test('division and remainder follow WGSL semantics', () => {
  const { INT_MIN } = Fixed;
  assert.equal(Fixed.idiv(7, 0), 7);
  assert.equal(Fixed.idiv(INT_MIN, -1), INT_MIN);
  assert.equal(Fixed.idiv(-7, 2), -3);
  assert.equal(Fixed.idiv(7, -2), -3);
  assert.equal(Fixed.imod(-7, 2), -1);
  assert.equal(Fixed.imod(7, 0), 0);
  assert.equal(Fixed.imod(INT_MIN, -1), 0);
  assert.equal(Fixed.udiv(7, 0), 7);
  assert.equal(Fixed.umod(7, 0), 0);
  assert.equal(Fixed.udiv(0xffffffff, 2), 0x7fffffff);
  assert.equal(Fixed.umod(0xffffffff, 10), 5);
  const rnd = new TestRandom(4);
  for (let i = 0; i < 100000; i++) {
    const a = rnd.i32(), b = rnd.i32() >> rnd.below(31);
    if (b === 0 || (a === INT_MIN && b === -1)) continue;
    const q = BigInt(a) / BigInt(b); // BigInt division truncates toward zero, like WGSL
    assert.equal(Fixed.idiv(a, b), Number(q), `idiv(${a}, ${b})`);
    assert.equal(Fixed.imod(a, b), Number(BigInt(a) - q * BigInt(b)), `imod(${a}, ${b})`);
    const ua = a >>> 0, ub = b >>> 0;
    assert.equal(Fixed.udiv(ua, ub), Number(BigInt(ua) / BigInt(ub)), `udiv(${ua}, ${ub})`);
    assert.equal(Fixed.umod(ua, ub), Number(BigInt(ua) % BigInt(ub)), `umod(${ua}, ${ub})`);
  }
});

test('iabs matches WGSL abs (abs(INT_MIN) = INT_MIN)', () => {
  assert.equal(Fixed.iabs(Fixed.INT_MIN), Fixed.INT_MIN);
  assert.equal(Fixed.iabs(-5), 5);
  assert.equal(Fixed.iabs(5), 5);
  assert.equal(Fixed.iabs(0), 0);
});
