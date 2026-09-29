// @ts-check
// Pass 13: targeting (policy `nearest`). Each fire command picks the live unit in range that minimizes
// (distance², slot), and requests a shot toward it for the next tick. Twin: kernels/targeting.wgsl
// (one workgroup per command, with a tree reduction).
import { FIRE_WORDS, OH, REQ_WORDS, UNIT_ALIVE } from '../swarm-layout.js';
import { SwarmMath } from './swarm-math.js';

const aim = new Int32Array(2);

export class Targeting {
  /** @param {import('./swarm-buffers.js').SwarmBuffers} b @param {import('./swarm-buffers.js').TickParams} p */
  static run(b, p) {
    const L = b.L;
    const W = L.gridW;
    for (let k = 0; k < p.fires; k++) {
      const f = p.inBase + L.inFires + k * FIRE_WORDS;
      const range = b.I[f + 2];
      const ox = b.I[f + 4];
      const oy = b.I[f + 5];
      const cr = (range >> L.cellShift) + 1;
      const cx = SwarmMath.cellX(L, ox);
      const cy = SwarmMath.cellY(L, oy);
      const x0 = Math.max(cx - cr, 0);
      const x1 = Math.min(cx + cr, W - 1);
      const y0 = Math.max(cy - cr, 0);
      const y1 = Math.min(cy + cr, W - 1);
      const r2 = Math.imul(range, range);
      let bestD = 0x7fffffff;
      let best = -1;
      for (let ny = y0; ny <= y1; ny++) {
        for (let nx = x0; nx <= x1; nx++) {
          const c = Math.imul(ny, W) + nx;
          const start = L.aBinEntries + b.A[L.aBinStart + c];
          const count = b.A[L.aBinCount + c];
          for (let e = 0; e < count; e++) {
            const j = b.A[start + e];
            if ((b.U[L.uInfo + j] & UNIT_ALIVE) === 0) continue;
            const dx = b.Ui[L.uPosX + j] - ox;
            const dy = b.Ui[L.uPosY + j] - oy;
            if (dx > range || dx < -range || dy > range || dy < -range) continue;
            const d = Math.imul(dx, dx) + Math.imul(dy, dy);
            if (d > r2) continue;
            if (d < bestD || (d === bestD && j < best)) {
              bestD = d;
              best = j;
            }
          }
        }
      }
      const r = L.aReq + k * REQ_WORDS;
      if (best < 0) {
        b.A[r] = 0;
        continue;
      }
      const shot = b.I[f + 6];
      SwarmMath.scaleTo(b.Ui[L.uPosX + best] - ox, b.Ui[L.uPosY + best] - oy, shot & 0xffff, aim);
      b.A[r] = 1;
      b.A[r + 1] = ox;
      b.A[r + 2] = oy;
      b.A[r + 3] = SwarmMath.packVel(aim[0], aim[1]);
      b.A[r + 4] = b.I[f + 3];
      b.A[r + 5] = (shot >>> 16) | (b.I[f + 1] & 0xff0000);
      b.A[r + 6] = b.I[f] & 0xffff;
      b.A[r + 7] = 0;
      b.O[L.oFireBits + (k >>> 5)] |= 1 << (k & 31);
      b.O[OH.FIRED]++;
    }
  }
}
