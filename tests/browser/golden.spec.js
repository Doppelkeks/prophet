import { test, expect } from '@playwright/test';
import { Fixed } from '../../engine/core/fixed.js';
import { Rng } from '../../engine/core/rng.js';
import { Hash32 } from '../../engine/core/hash32.js';
import { EDGE_I32, TestRandom } from '../support/vectors.js';

/**
 * Each case: op code, item generator (4 u32 words), and the JS twin producing the expected u32.
 * @type {{ name: string, op: number, items: () => number[][], js: (w: number[]) => number }[]}
 */
const CASES = [
  { name: 'sinB', op: 0, items: () => range(65536).map((a) => [a, 0, 0, 0]), js: ([a]) => Fixed.sinB(a) },
  { name: 'cosB', op: 1, items: () => range(65536).map((a) => [a, 0, 0, 0]), js: ([a]) => Fixed.cosB(a) },
  {
    name: 'mulShr',
    op: 2,
    items: () => {
      const out = [];
      for (const a of EDGE_I32) for (const b of EDGE_I32) for (const s of [0, 1, 10, 14, 16, 31]) out.push([a, b, s, 0]);
      const r = new TestRandom(21);
      for (let i = 0; i < 20000; i++) out.push([r.i32(), r.i32(), r.below(32), 0]);
      return out;
    },
    js: ([a, b, s]) => Fixed.mulShr(a | 0, b | 0, s),
  },
  {
    name: 'isqrt',
    op: 3,
    items: () => {
      const r = new TestRandom(22);
      return [...range(65536).map((n) => [n, 0, 0, 0]), [0xffffffff, 0, 0, 0], ...range(20000).map(() => [r.u32(), 0, 0, 0])];
    },
    js: ([n]) => Fixed.isqrt(n),
  },
  { name: 'idiv', op: 4, items: () => divItems(23), js: ([a, b]) => Fixed.idiv(a | 0, b | 0) },
  { name: 'imod', op: 5, items: () => divItems(24), js: ([a, b]) => Fixed.imod(a | 0, b | 0) },
  { name: 'udiv', op: 6, items: () => divItems(25), js: ([a, b]) => Fixed.udiv(a, b) },
  { name: 'umod', op: 7, items: () => divItems(26), js: ([a, b]) => Fixed.umod(a, b) },
  { name: 'iabs', op: 8, items: () => EDGE_I32.map((a) => [a, 0, 0, 0]), js: ([a]) => Fixed.iabs(a | 0) },
  { name: 'mulHiU32', op: 9, items: () => randomItems(27, 20000), js: ([a, b]) => Fixed.mulHiU32(a, b) },
  { name: 'mix32', op: 10, items: () => randomItems(28, 20000), js: ([a]) => Rng.mix32(a) },
  { name: 'rngU32', op: 11, items: () => randomItems(29, 20000), js: ([a, b, c, d]) => Rng.u32(Rng.key(a, b), c, d) },
  { name: 'below', op: 12, items: () => randomItems(30, 20000), js: ([a, b]) => Rng.below(a, b) },
  { name: 'hash', op: 13, items: () => randomItems(31, 20000), js: ([a, b, c, d]) => Hash32.end(Hash32.step(Hash32.step(Hash32.step(a, b), c), d), 3) },
];

/** @param {number} n */
function range(n) {
  return Array.from({ length: n }, (_, i) => i);
}
/** @param {number} seed @param {number} n */
function randomItems(seed, n) {
  const r = new TestRandom(seed);
  return range(n).map(() => [r.u32(), r.u32(), r.u32(), r.u32()]);
}
/** Division edge cases (incl. b = 0 and INT_MIN / -1) plus random pairs. @param {number} seed */
function divItems(seed) {
  const out = [];
  for (const a of EDGE_I32) for (const b of EDGE_I32) out.push([a >>> 0, b >>> 0, 0, 0]);
  const r = new TestRandom(seed);
  for (let i = 0; i < 20000; i++) out.push([r.u32(), r.u32() >>> r.below(32), 0, 0]);
  return out;
}

test('WGSL twins match the JS implementations bit for bit', async ({ page }) => {
  await page.goto('/tests/browser/pages/golden.html');
  await page.waitForFunction(() => /** @type {any} */ (window).__goldenReady === true);
  for (const c of CASES) {
    const items = c.items();
    const words = items.flatMap((w) => w.map((x) => x >>> 0));
    const got = await page.evaluate(([op, w]) => /** @type {any} */ (window).runGolden(op, w), /** @type {const} */ ([c.op, words]));
    const expected = items.map((w) => c.js(w.map((x) => x >>> 0)) >>> 0);
    const bad = expected.findIndex((e, i) => e !== got[i]);
    expect(bad, `${c.name}: first mismatch at item ${bad} (${JSON.stringify(items[bad])}) gpu=${got[bad]} js=${expected[bad]}`).toBe(-1);
  }
});
