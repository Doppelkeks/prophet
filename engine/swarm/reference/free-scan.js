// @ts-check
// Pass 2: free-slot scan. An exclusive prefix over each pool's dead flags lists the free slots in
// ascending order (deterministic slot allocation). Twin: kernels/scan.wgsl (free-flag variant).
import { MISC, SHOT_ALIVE, UNIT_ALIVE } from '../swarm-layout.js';

export class FreeScan {
  /** @param {import('./swarm-buffers.js').SwarmBuffers} b */
  static run(b) {
    const L = b.L;
    let n = 0;
    for (let i = 0; i < L.unitCap; i++) if ((b.U[L.uInfo + i] & UNIT_ALIVE) === 0) b.A[L.aUnitFree + n++] = i;
    b.A[L.aMisc + MISC.UNIT_FREE] = n;
    n = 0;
    for (let i = 0; i < L.shotCap; i++) if ((b.P[L.pInfo + i] & SHOT_ALIVE) === 0) b.A[L.aShotFree + n++] = i;
    b.A[L.aMisc + MISC.SHOT_FREE] = n;
  }
}
