// @ts-check
// Pass 7: every live unit writes its slot into its cell's range. On the GPU the order inside a cell
// depends on atomic timing, so no consumer may depend on it; shuffle mode randomizes it here to prove
// that. Twin: kernels/bin-scatter.wgsl.
import { UNIT_ALIVE } from '../swarm-layout.js';
import { SwarmMath } from './swarm-math.js';

export class BinScatter {
  /**
   * @param {import('./swarm-buffers.js').SwarmBuffers} b
   * @param {{ next(): number } | null} shuffle
   */
  static run(b, shuffle) {
    const L = b.L;
    for (let i = 0; i < L.unitCap; i++) {
      if ((b.U[L.uInfo + i] & UNIT_ALIVE) === 0) continue;
      const c = Math.imul(SwarmMath.cellY(L, b.Ui[L.uPosY + i]), L.gridW) + SwarmMath.cellX(L, b.Ui[L.uPosX + i]);
      const at = b.A[L.aBinCursor + c]++;
      b.A[L.aBinEntries + b.A[L.aBinStart + c] + at] = i;
    }
    if (!shuffle) return;
    for (let c = 0; c < L.cells; c++) {
      const start = L.aBinEntries + b.A[L.aBinStart + c];
      for (let k = b.A[L.aBinCount + c] - 1; k > 0; k--) {
        const j = shuffle.next() % (k + 1);
        const t = b.A[start + k];
        b.A[start + k] = b.A[start + j];
        b.A[start + j] = t;
      }
    }
  }
}
