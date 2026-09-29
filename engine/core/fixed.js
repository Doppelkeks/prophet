// @ts-check
// Integer fixed-point math for the simulation (docs/engine/09-determinism-coop.md#fixed-point-formats).
// Twin of engine/gpu/wgsl/fixed.wgsl: every operation is built from 32-bit integer steps that have
// exactly the same result in JS and in WGSL. Formats: positions Q10, HP Q8, multipliers Q12,
// sine Q14, chances Q16, angles as 16-bit binary angles (65,536 = 360 degrees).
import { SIN_TABLE_Q14 } from './sin-table.js';

export class Fixed {
  static Q8 = 256;
  static Q10 = 1024;
  static Q12 = 4096;
  static Q14 = 16384;
  static Q16 = 65536;
  static INT_MIN = -2147483648;
  static INT_MAX = 2147483647;
  /** A quarter turn in binary angle units. */
  static QUARTER = 16384;

  /** Sine of a binary angle (only the low 16 bits matter), Q14. @param {number} a */
  static sinB(a) {
    return SIN_TABLE_Q14[(a >>> 4) & 4095];
  }

  /** Cosine of a binary angle, Q14. @param {number} a */
  static cosB(a) {
    return SIN_TABLE_Q14[((a + 16384) >>> 4) & 4095];
  }

  /**
   * Exact floor((a * b) / 2^s) for i32 `a`, `b` and 0 <= s <= 31, wrapped to i32.
   * The 64-bit product is computed exactly from 16-bit limbs (no floats, no BigInt).
   * @param {number} a @param {number} b @param {number} s
   */
  static mulShr(a, b, s) {
    const au = a >>> 0;
    const bu = b >>> 0;
    const a0 = au & 0xffff, a1 = au >>> 16, b0 = bu & 0xffff, b1 = bu >>> 16;
    const p00 = Math.imul(a0, b0) >>> 0;
    const p01 = Math.imul(a0, b1) >>> 0;
    const p10 = Math.imul(a1, b0) >>> 0;
    const p11 = Math.imul(a1, b1) >>> 0;
    const mid = (p00 >>> 16) + (p01 & 0xffff) + (p10 & 0xffff);
    const lo = ((p00 & 0xffff) | (mid << 16)) >>> 0;
    let hi = (p11 + (p01 >>> 16) + (p10 >>> 16) + (mid >>> 16)) >>> 0;
    // Two's-complement correction turns the unsigned product into the signed one.
    if (a < 0) hi = (hi - bu) >>> 0;
    if (b < 0) hi = (hi - au) >>> 0;
    if (s === 0) return lo | 0;
    return ((lo >>> s) | (hi << (32 - s))) | 0;
  }

  /** High 32 bits of the unsigned 64-bit product of two u32 values. @param {number} a @param {number} b */
  static mulHiU32(a, b) {
    const au = a >>> 0;
    const bu = b >>> 0;
    const a0 = au & 0xffff, a1 = au >>> 16, b0 = bu & 0xffff, b1 = bu >>> 16;
    const p00 = Math.imul(a0, b0) >>> 0;
    const p01 = Math.imul(a0, b1) >>> 0;
    const p10 = Math.imul(a1, b0) >>> 0;
    const p11 = Math.imul(a1, b1) >>> 0;
    const mid = (p00 >>> 16) + (p01 & 0xffff) + (p10 & 0xffff);
    return (p11 + (p01 >>> 16) + (p10 >>> 16) + (mid >>> 16)) >>> 0;
  }

  /** floor(sqrt(n)) for a u32 `n`; digit by digit, always 16 iterations. @param {number} n */
  static isqrt(n) {
    let x = n >>> 0;
    let r = 0;
    let bit = 0x40000000;
    for (let i = 0; i < 16; i++) {
      const t = r + bit;
      if (x >= t) {
        x -= t;
        r = (r >>> 1) + bit;
      } else {
        r >>>= 1;
      }
      bit >>>= 2;
    }
    return r >>> 0;
  }

  /**
   * i32 division with WGSL semantics: truncates toward zero, `a / 0 = a`, `INT_MIN / -1 = INT_MIN`.
   * For i32 operands the float quotient never rounds across an integer, so truncation is exact.
   * @param {number} a @param {number} b
   */
  static idiv(a, b) {
    if (b === 0) return a | 0;
    return (a / b) | 0; // sim-allow: exact truncating i32 division (see above)
  }

  /** i32 remainder with WGSL semantics: sign of the dividend, `a % 0 = 0`, `INT_MIN % -1 = 0`. @param {number} a @param {number} b */
  static imod(a, b) {
    return (a % b) | 0;
  }

  /** u32 division with WGSL semantics (`a / 0 = a`). @param {number} a @param {number} b */
  static udiv(a, b) {
    const ub = b >>> 0;
    if (ub === 0) return a >>> 0;
    return ((a >>> 0) / ub) >>> 0; // sim-allow: exact truncating u32 division
  }

  /** u32 remainder with WGSL semantics (`a % 0 = 0`). @param {number} a @param {number} b */
  static umod(a, b) {
    const ub = b >>> 0;
    if (ub === 0) return 0;
    return ((a >>> 0) % ub) >>> 0;
  }

  /** |a| with WGSL semantics: abs(INT_MIN) = INT_MIN. @param {number} a */
  static iabs(a) {
    const m = a >> 31;
    return ((a ^ m) - m) | 0;
  }

  /** @param {number} v @param {number} lo @param {number} hi */
  static clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }
}
