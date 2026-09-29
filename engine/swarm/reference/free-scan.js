// @ts-check
// Pass 2: free-slot scan. An exclusive prefix over each pool's dead flags lists the free slots in
// ascending order (deterministic slot allocation); the same kind of scan lists the units whose death
// last tick dropped scrap, in slot order. Twin: kernels/scan.wgsl (MODE 0, 1, 3 and 4).
import { MISC, PICK_ALIVE, SHOT_ALIVE, UNIT_ALIVE } from '../swarm-layout.js';

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
    n = 0;
    for (let i = 0; i < L.pickCap; i++) if ((b.P[L.kInfo + i] & PICK_ALIVE) === 0) b.A[L.aPickFree + n++] = i;
    b.A[L.aMisc + MISC.PICK_FREE] = n;
    n = 0;
    for (let i = 0; i < L.unitCap; i++) if (b.A[L.aDrop + i] !== 0) b.A[L.aDropReq + n++] = i;
    b.A[L.aMisc + MISC.DROPS] = n;
  }
}
