// @ts-check
// Pass 8: steering. Seek toward proxy 0, separation from the 3×3 bin neighbourhood, soft push from
// pushing proxies. Writes only the unit's own velocity; every term is an order-independent integer sum
// (docs/engine/05-gpu-swarm.md#pass-chain). With a flow field, the seek follows the field's direction in
// the unit's cell until it is within FIELD_DIRECT of the goal (or its cell has no path), then heads straight
// for proxy 0. Slowed units steer at half speed; stunned ones don't seek.
// Knockback above the speed limit is not clipped: it decays through the velocity smoothing.
// Twin: kernels/steer.wgsl.
import { Fixed } from '../../core/fixed.js';
import { FIELD_DIRECT, FIELD_NONE, FIELD_NO_PATH, PROXY_WORDS, TY, TYPE_WORDS, UNIT_ALIVE } from '../swarm-layout.js';
import { ProxyFlag } from '../swarm-contract.js';
import { SwarmMath } from './swarm-math.js';

/** Separation sum → velocity: >> 4. */
export const SEP_SHIFT = 4;
/** Proxy push sum → velocity: >> 2. */
export const PUSH_SHIFT = 2;
/** Density-gradient pressure per unit of count difference (Q10 per tick, before SEP_SHIFT). */
export const PRESSURE = 64;

const seek = new Int32Array(2);

export class Steer {
  /** @param {import('./swarm-buffers.js').SwarmBuffers} b @param {import('./swarm-buffers.js').TickParams} p */
  static run(b, p) {
    const L = b.L;
    const W = L.gridW;
    const proxies = p.inBase + L.inProxies;
    for (let i = 0; i < L.unitCap; i++) {
      const info = b.U[L.uInfo + i];
      if ((info & UNIT_ALIVE) === 0) continue;
      const x = b.Ui[L.uPosX + i];
      const y = b.Ui[L.uPosY + i];
      const type = L.tTypes + (info & 0xff) * TYPE_WORDS;
      const st0 = b.U[L.uSt0 + i];
      const stunned = (st0 >>> 24) !== 0; // status 3
      const spd = ((st0 >>> 16) & 0xff) !== 0 ? b.T[type + TY.SPEED] >> 1 : b.T[type + TY.SPEED]; // status 2: slowed
      const ri = b.T[type + TY.RADIUS];
      const cx = SwarmMath.cellX(L, x);
      const cy = SwarmMath.cellY(L, y);
      let sx = 0;
      let sy = 0;
      for (let oy = -1; oy <= 1; oy++) {
        const ny = cy + oy;
        if (ny < 0 || ny >= W) continue;
        for (let ox = -1; ox <= 1; ox++) {
          const nx = cx + ox;
          if (nx < 0 || nx >= W) continue;
          const c = Math.imul(ny, W) + nx;
          const n = b.A[L.aBinCount + c];
          if (n === 0) continue;
          if (n <= L.pairCap) {
            const start = L.aBinEntries + b.A[L.aBinStart + c];
            for (let e = 0; e < n; e++) {
              const j = b.A[start + e];
              if (j === i) continue;
              const r = ri + b.T[L.tTypes + (b.U[L.uInfo + j] & 0xff) * TYPE_WORDS + TY.RADIUS];
              const dx = x - b.Ui[L.uPosX + j];
              const dy = y - b.Ui[L.uPosY + j];
              if (dx >= r || dx <= -r || dy >= r || dy <= -r) continue;
              if (dx === 0 && dy === 0) sx += i < j ? -r : r;
              else {
                sx += SwarmMath.rep(dx, r);
                sy += SwarmMath.rep(dy, r);
              }
            }
          } else {
            // Dense cell: one virtual neighbour at the cell's centroid, weighted by the pairwise cap.
            const mx = L.originX + (nx << L.cellShift) + Fixed.idiv(b.A[L.aBinSumX + c], n);
            const my = L.originY + (ny << L.cellShift) + Fixed.idiv(b.A[L.aBinSumY + c], n);
            const r = ri + ri;
            const dx = x - mx;
            const dy = y - my;
            if (dx < r && dx > -r && dy < r && dy > -r) {
              sx += Math.imul(SwarmMath.rep(dx, r), L.pairCap);
              sy += Math.imul(SwarmMath.rep(dy, r), L.pairCap);
            }
          }
        }
      }
      const own = b.A[L.aBinCount + Math.imul(cy, W) + cx];
      if (own > L.pairCap) {
        const left = cx > 0 ? b.A[L.aBinCount + Math.imul(cy, W) + cx - 1] : own;
        const right = cx < W - 1 ? b.A[L.aBinCount + Math.imul(cy, W) + cx + 1] : own;
        const down = cy > 0 ? b.A[L.aBinCount + Math.imul(cy - 1, W) + cx] : own;
        const up = cy < W - 1 ? b.A[L.aBinCount + Math.imul(cy + 1, W) + cx] : own;
        sx += Math.imul(left - right, PRESSURE);
        sy += Math.imul(down - up, PRESSURE);
      }
      let px = 0;
      let py = 0;
      seek[0] = 0;
      seek[1] = 0;
      for (let k = 0; k < p.proxies; k++) {
        const q = proxies + k * PROXY_WORDS;
        const qx = b.I[q + 1];
        const qy = b.I[q + 2];
        if (k === 0 && !stunned) {
          const word = p.field === FIELD_NONE ? 0 : b.G[Math.imul(p.field, L.cells) + Math.imul(cy, W) + cx];
          const dist = word >>> 16;
          if (dist !== FIELD_NO_PATH && dist > FIELD_DIRECT) {
            const a = word & 0xffff;
            seek[0] = Fixed.mulShr(spd, Fixed.cosB(a), 14);
            seek[1] = Fixed.mulShr(spd, Fixed.sinB(a), 14);
          } else {
            SwarmMath.scaleTo(qx - x, qy - y, spd, seek);
          }
        }
        if (((b.I[q + 4] >>> 16) & ProxyFlag.PUSHES) === 0) continue;
        const r = b.I[q + 3] + ri;
        const dx = x - qx;
        const dy = y - qy;
        if (dx >= r || dx <= -r || dy >= r || dy <= -r) continue;
        px += SwarmMath.rep(dx, r);
        py += SwarmMath.rep(dy, r);
      }
      const v = b.U[L.uVel + i];
      const lim = spd + spd;
      const ax = SwarmMath.approach(SwarmMath.lo16(v), seek[0]);
      const ay = SwarmMath.approach(SwarmMath.hi16(v), seek[1]);
      const vx = ax + Fixed.clamp(sx >> SEP_SHIFT, -spd, spd) + Fixed.clamp(px >> PUSH_SHIFT, -lim, lim);
      const vy = ay + Fixed.clamp(sy >> SEP_SHIFT, -spd, spd) + Fixed.clamp(py >> PUSH_SHIFT, -lim, lim);
      const limX = ax > lim ? ax : -ax > lim ? -ax : lim; // a knockback still decaying may exceed the limit
      const limY = ay > lim ? ay : -ay > lim ? -ay : lim;
      b.U[L.uVel + i] = SwarmMath.packVel(Fixed.clamp(vx, -limX, limX), Fixed.clamp(vy, -limY, limY));
    }
  }
}
