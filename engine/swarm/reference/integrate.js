// @ts-check
// Pass 9: fixed-point integration, clamped to the arena. Twin: kernels/integrate.wgsl.
import { Fixed } from '../../core/fixed.js';
import { UNIT_ALIVE } from '../swarm-layout.js';
import { SwarmMath } from './swarm-math.js';

export class Integrate {
  /** @param {import('./swarm-buffers.js').SwarmBuffers} b */
  static run(b) {
    const L = b.L;
    const half = L.arenaHalf;
    for (let i = 0; i < L.unitCap; i++) {
      if ((b.U[L.uInfo + i] & UNIT_ALIVE) === 0) continue;
      const v = b.U[L.uVel + i];
      b.Ui[L.uPosX + i] = Fixed.clamp(b.Ui[L.uPosX + i] + SwarmMath.lo16(v), -half, half);
      b.Ui[L.uPosY + i] = Fixed.clamp(b.Ui[L.uPosY + i] + SwarmMath.hi16(v), -half, half);
    }
  }
}
