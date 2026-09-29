// @ts-check
// Integer helpers shared by the reference kernels. Twin: engine/swarm/kernels/swarm-common.wgsl.
import { Fixed } from '../../core/fixed.js';

export class SwarmMath {
  /** Low half of a packed velocity, sign-extended. @param {number} v */
  static lo16(v) {
    return (v << 16) >> 16;
  }

  /** High half of a packed velocity, sign-extended. @param {number} v */
  static hi16(v) {
    return v >> 16;
  }

  /** @param {number} vx @param {number} vy */
  static packVel(vx, vy) {
    return ((vx & 0xffff) | (vy << 16)) >>> 0;
  }

  /** Linear repulsion along one axis: magnitude r − |d|, pointing along d; 0 when d is 0. @param {number} d @param {number} r */
  static rep(d, r) {
    return d > 0 ? r - d : d < 0 ? -r - d : 0;
  }

  /**
   * Moves a velocity a quarter of the way to its target; within 4 it snaps to the target, so it
   * settles exactly (a plain `>> 2` would leave negative velocities drifting forever).
   * @param {number} v @param {number} target
   */
  static approach(v, target) {
    const d = target - v;
    return d < 4 && d > -4 ? target : v + (d >> 2);
  }

  /**
   * Whether bin cell (cx, cy) is blocked (the blocked bits in T, from the nav cost grid).
   * @param {Record<string, number>} L @param {Int32Array} T @param {number} cx @param {number} cy
   */
  static blocked(L, T, cx, cy) {
    const c = Math.imul(cy, L.gridW) + cx;
    return ((T[L.tBlocked + (c >>> 5)] >>> (c & 31)) & 1) !== 0;
  }

  /** Bin column of a position. @param {Record<string, number>} L @param {number} x */
  static cellX(L, x) {
    return Fixed.clamp((x - L.originX) >> L.cellShift, 0, L.gridW - 1);
  }

  /** @param {Record<string, number>} L @param {number} y */
  static cellY(L, y) {
    return Fixed.clamp((y - L.originY) >> L.cellShift, 0, L.gridW - 1);
  }

  /**
   * Scales (dx, dy) to length `len` without overflow: halve until both fit 14 bits, then
   * divide by the integer length. Writes out[0], out[1].
   * @param {number} dx @param {number} dy @param {number} len @param {Int32Array} out
   */
  static scaleTo(dx, dy, len, out) {
    let ax = dx;
    let ay = dy;
    while (ax >= 16384 || ax <= -16384 || ay >= 16384 || ay <= -16384) {
      ax >>= 1;
      ay >>= 1;
    }
    const m = Fixed.isqrt(Math.imul(ax, ax) + Math.imul(ay, ay));
    if (m === 0) {
      out[0] = 0;
      out[1] = 0;
      return;
    }
    out[0] = Fixed.idiv(Math.imul(ax, len), m);
    out[1] = Fixed.idiv(Math.imul(ay, len), m);
  }
}
