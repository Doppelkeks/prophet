// @ts-check
// Pass 5: every live unit counts itself into its 2 m bin and adds its position inside the cell to the
// cell's sums (for the dense-cell centroid). Counts and sums commute. Twin: kernels/bin-count.wgsl.
import { Fixed } from '../../core/fixed.js';
import { UNIT_ALIVE } from '../swarm-layout.js';
import { SwarmMath } from './swarm-math.js';

export class BinCount {
  /** @param {import('./swarm-buffers.js').SwarmBuffers} b */
  static run(b) {
    const L = b.L;
    const cellMax = (1 << L.cellShift) - 1;
    for (let i = 0; i < L.unitCap; i++) {
      if ((b.U[L.uInfo + i] & UNIT_ALIVE) === 0) continue;
      const x = b.Ui[L.uPosX + i];
      const y = b.Ui[L.uPosY + i];
      const cx = SwarmMath.cellX(L, x);
      const cy = SwarmMath.cellY(L, y);
      const c = Math.imul(cy, L.gridW) + cx;
      b.A[L.aBinCount + c]++;
      b.A[L.aBinSumX + c] += Fixed.clamp(x - L.originX - (cx << L.cellShift), 0, cellMax);
      b.A[L.aBinSumY + c] += Fixed.clamp(y - L.originY - (cy << L.cellShift), 0, cellMax);
    }
  }
}
