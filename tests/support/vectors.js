// Shared test inputs. TestRandom is an xorshift32 generator that is independent of the engine's Rng,
// so the engine's own code never generates the inputs it is tested with.

export const EDGE_I32 = [
  0, 1, -1, 2, -2, 3, -3, 1023, 1024, -1024, 16384, -16384, 32767, -32768, 65535, 65536, -65536,
  0x12345678, -0x12345678, 0x7fff0000, -0x7fff0000, 2147483647, -2147483648, -2147483647,
];

export class TestRandom {
  /** @param {number} seed nonzero */
  constructor(seed) {
    this.s = seed >>> 0 || 1;
  }
  u32() {
    let x = this.s;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.s = x >>> 0;
    return this.s;
  }
  i32() {
    return this.u32() | 0;
  }
  /** @param {number} n */
  below(n) {
    return Number((BigInt(this.u32()) * BigInt(n)) >> 32n);
  }
}
