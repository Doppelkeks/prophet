// @ts-check
// Pass 1: clears the per-tick scratch (bin counts, sums and cursors) and the outbound block. On a swarm
// reset (inbound flag bit 0) it also empties every pool. Twin: kernels/clear.wgsl.
import { REQ_WORDS } from '../swarm-layout.js';

export class ClearPass {
  /** @param {import('./swarm-buffers.js').SwarmBuffers} b @param {import('./swarm-buffers.js').TickParams} p */
  static run(b, p) {
    const L = b.L;
    const cells = L.cells;
    b.A.fill(0, L.aBinCount, L.aBinCount + cells);
    b.A.fill(0, L.aBinSumX, L.aBinSumX + cells);
    b.A.fill(0, L.aBinSumY, L.aBinSumY + cells);
    b.A.fill(0, L.aBinCursor, L.aBinCursor + cells);
    b.O.fill(0);
    if (p.flags & 1) {
      b.U.fill(0, L.uInfo, L.uInfo + L.unitCap);
      b.P.fill(0, L.pInfo, L.pInfo + L.shotCap);
      for (let k = 0; k < L.fireCap; k++) b.A[L.aReq + k * REQ_WORDS] = 0;
    }
  }
}
