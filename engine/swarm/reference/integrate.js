// @ts-check
// Pass 9: fixed-point integration, clamped to the arena. Ground units slide against blocked cells: the x
// step first, then the y step, each refused (and that velocity component zeroed) if it would enter a
// blocked cell. Twin: kernels/integrate.wgsl.
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
      let vx = SwarmMath.lo16(v);
      let vy = SwarmMath.hi16(v);
      const x0 = b.Ui[L.uPosX + i];
      const y0 = b.Ui[L.uPosY + i];
      let x = Fixed.clamp(x0 + vx, -half, half);
      if (SwarmMath.blocked(L, b.T, SwarmMath.cellX(L, x), SwarmMath.cellY(L, y0))) {
        x = x0;
        vx = 0;
      }
      let y = Fixed.clamp(y0 + vy, -half, half);
      if (SwarmMath.blocked(L, b.T, SwarmMath.cellX(L, x), SwarmMath.cellY(L, y))) {
        y = y0;
        vy = 0;
      }
      b.Ui[L.uPosX + i] = x;
      b.Ui[L.uPosY + i] = y;
      b.U[L.uVel + i] = SwarmMath.packVel(vx, vy);
    }
  }
}
