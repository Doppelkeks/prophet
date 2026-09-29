// @ts-check
// Stateless hash RNG (docs/engine/09-determinism-coop.md#random-numbers).
// Every random value is a pure function of (seed, stream, tick, id), identical in JS and WGSL
// (twin: engine/gpu/wgsl/rng.wgsl). There is no generator state to save, share or race on.
import { Fixed } from './fixed.js';

export class Rng {
  /** lowbias32 integer mixer (Chris Wellons). @param {number} x u32 */
  static mix32(x) {
    x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
    x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
    return (x ^ (x >>> 16)) >>> 0;
  }

  /** Key for one random stream of a run. @param {number} seed u32 @param {number} stream small integer */
  static key(seed, stream) {
    return Rng.mix32((seed ^ Math.imul(stream + 1, 0x9e3779b9)) >>> 0);
  }

  /** Random u32 for (stream key, tick, id). @param {number} key @param {number} tick @param {number} id */
  static u32(key, tick, id) {
    return Rng.mix32((Rng.mix32((key ^ tick) >>> 0) ^ id) >>> 0);
  }

  /** Uniform integer in [0, n) from a random u32 (multiply-high, no modulo bias hot spots). @param {number} h @param {number} n */
  static below(h, n) {
    return Fixed.mulHiU32(h, n);
  }

  /** True with probability pQ16 / 65536. @param {number} h @param {number} pQ16 */
  static chance(h, pQ16) {
    return h >>> 16 < pQ16;
  }
}
