// @ts-check
// Pass 10: shots move, then hit the nearest live unit by (distance², slot) in the 3×3 bins around them,
// skipping the unit they hit last. Damage and kill credit go into per-unit atomics, which commute.
// Twin: kernels/projectiles.wgsl.
import { OH, SHOT_ALIVE, TY, TYPE_WORDS, UNIT_ALIVE } from '../swarm-layout.js';
import { SwarmMath } from './swarm-math.js';

/** Shot radius: 0.25 m. */
export const SHOT_RADIUS = 256;

export class Projectiles {
  /**
   * @param {import('./swarm-buffers.js').SwarmBuffers} b
   * @param {{ next(): number } | null} shuffle visits shots in a random order (the result must not change)
   */
  static run(b, shuffle) {
    const L = b.L;
    const n = L.shotCap;
    const order = shuffle ? Projectiles.#shuffled(n, shuffle) : null;
    for (let k = 0; k < n; k++) Projectiles.#shot(b, order ? order[k] : k);
  }

  /** @param {import('./swarm-buffers.js').SwarmBuffers} b @param {number} s */
  static #shot(b, s) {
    const L = b.L;
    const W = L.gridW;
    let info = b.P[L.pInfo + s];
    if ((info & SHOT_ALIVE) === 0) return;
    const v = b.P[L.pVel + s];
    const x = b.Pi[L.pPosX + s] + SwarmMath.lo16(v);
    const y = b.Pi[L.pPosY + s] + SwarmMath.hi16(v);
    b.Pi[L.pPosX + s] = x;
    b.Pi[L.pPosY + s] = y;
    const last = b.P[L.pLastHit + s];
    const cx = SwarmMath.cellX(L, x);
    const cy = SwarmMath.cellY(L, y);
    let bestD = 0x7fffffff;
    let best = -1;
    for (let oy = -1; oy <= 1; oy++) {
      const ny = cy + oy;
      if (ny < 0 || ny >= W) continue;
      for (let ox = -1; ox <= 1; ox++) {
        const nx = cx + ox;
        if (nx < 0 || nx >= W) continue;
        const c = Math.imul(ny, W) + nx;
        const start = L.aBinEntries + b.A[L.aBinStart + c];
        const count = b.A[L.aBinCount + c];
        for (let e = 0; e < count; e++) {
          const j = b.A[start + e];
          if (j === last) continue;
          const uinfo = b.U[L.uInfo + j];
          if ((uinfo & UNIT_ALIVE) === 0) continue;
          const r = SHOT_RADIUS + b.T[L.tTypes + (uinfo & 0xff) * TYPE_WORDS + TY.RADIUS];
          const dx = b.Ui[L.uPosX + j] - x;
          const dy = b.Ui[L.uPosY + j] - y;
          if (dx > r || dx < -r || dy > r || dy < -r) continue;
          const d = Math.imul(dx, dx) + Math.imul(dy, dy);
          if (d > Math.imul(r, r)) continue;
          if (d < bestD || (d === bestD && j < best)) {
            bestD = d;
            best = j;
          }
        }
      }
    }
    let life = (info & 0xffff) - 1;
    let pierce = (info >>> 16) & 0xff;
    let alive = life > 0;
    if (best >= 0) {
      const dmg = b.Pi[L.pDmg + s];
      b.A[L.aDmg + best] += dmg;
      const credit = ((Math.min(dmg >> 8, 0x7ffe) + 1) << 16) | (b.P[L.pSource + s] & 0xffff);
      if (credit > b.A[L.aKiller + best]) b.A[L.aKiller + best] = credit;
      b.P[L.pLastHit + s] = best;
      if (pierce === 0) alive = false;
      else pierce--;
    }
    if (!alive) {
      b.P[L.pInfo + s] = 0;
      return;
    }
    b.O[OH.SHOTS_ALIVE]++;
    info = (life | (pierce << 16) | SHOT_ALIVE) >>> 0;
    b.P[L.pInfo + s] = info;
  }

  /** @param {number} n @param {{ next(): number }} rnd */
  static #shuffled(n, rnd) {
    const order = new Int32Array(n);
    for (let k = 0; k < n; k++) order[k] = k;
    for (let k = n - 1; k > 0; k--) {
      const j = rnd.next() % (k + 1);
      const t = order[k];
      order[k] = order[j];
      order[j] = t;
    }
    return order;
  }
}
