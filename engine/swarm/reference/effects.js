// @ts-check
// Pass 10b: area effects. Each effect tests the units in the bins under its bounding box against its shape
// (circle, or ring between two radii) and adds damage (with kill credit), a radial impulse and its status
// tier into the units' accumulators. Sums, OR and max commute, so the order of effects, cells and bin
// entries never matters (docs/engine/05-gpu-swarm.md#pass-chain). Twin: kernels/effects.wgsl.
import { EFFECT_WORDS, UNIT_ALIVE } from '../swarm-layout.js';
import { EffectShape, Team } from '../swarm-contract.js';
import { SwarmMath } from './swarm-math.js';

export class Effects {
  static #push = new Int32Array(2);

  /** @param {import('./swarm-buffers.js').SwarmBuffers} b @param {import('./swarm-buffers.js').TickParams} p */
  static run(b, p) {
    const L = b.L;
    const W = L.gridW;
    const push = Effects.#push;
    for (let e = 0; e < p.effects; e++) {
      const at = p.inBase + L.inEffects + e * EFFECT_WORDS;
      const w0 = b.I[at];
      if (((w0 >>> 8) & 0xff) !== Team.PLAYER) continue; // M2: player effects hit the swarm
      const ring = (w0 & 0xff) === EffectShape.RING;
      const status = (w0 >>> 16) & 0xff;
      const tier = w0 >>> 24;
      const ex = b.I[at + 1];
      const ey = b.I[at + 2];
      const r = b.I[at + 3];
      const inner = b.I[at + 4];
      const dmg = b.I[at + 5];
      const imp = b.I[at + 6];
      const code = tier > 0 ? ((1 << tier) - 1) << Math.imul(status, 3) : 0;
      const credit = dmg > 0 ? ((((dmg >> 8) < 0x7ffe ? dmg >> 8 : 0x7ffe) + 1) << 16) | (b.I[at + 7] & 0xffff) : 0;
      const x0 = SwarmMath.cellX(L, ex - r);
      const x1 = SwarmMath.cellX(L, ex + r);
      const y0 = SwarmMath.cellY(L, ey - r);
      const y1 = SwarmMath.cellY(L, ey + r);
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          const c = Math.imul(cy, W) + cx;
          const start = L.aBinEntries + b.A[L.aBinStart + c];
          const count = b.A[L.aBinCount + c];
          for (let k = 0; k < count; k++) {
            const j = b.A[start + k];
            if ((b.U[L.uInfo + j] & UNIT_ALIVE) === 0) continue;
            const dx = b.Ui[L.uPosX + j] - ex;
            const dy = b.Ui[L.uPosY + j] - ey;
            if (dx > r || dx < -r || dy > r || dy < -r) continue;
            const d = Math.imul(dx, dx) + Math.imul(dy, dy);
            if (d > Math.imul(r, r)) continue;
            if (ring && d < Math.imul(inner, inner)) continue;
            if (dmg !== 0) b.A[L.aDmg + j] += dmg;
            if (credit > b.A[L.aKiller + j]) b.A[L.aKiller + j] = credit;
            if (imp !== 0) {
              SwarmMath.scaleTo(dx, dy, imp, push);
              b.A[L.aImpX + j] += push[0];
              b.A[L.aImpY + j] += push[1];
            }
            b.A[L.aStApply + j] |= code;
          }
        }
      }
    }
  }
}
