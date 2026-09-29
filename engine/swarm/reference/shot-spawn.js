// @ts-check
// Pass 3: spawns the shots that last tick's targeting requested. Request k takes free shot slot k;
// requests beyond the free count are rejected in order and counted. Twin: kernels/shot-spawn.wgsl.
import { MISC, NO_HIT, OH, REQ_WORDS, SHOT_ALIVE } from '../swarm-layout.js';

export class ShotSpawn {
  /** @param {import('./swarm-buffers.js').SwarmBuffers} b @param {import('./swarm-buffers.js').TickParams} p */
  static run(b, p) {
    const L = b.L;
    const free = b.A[L.aMisc + MISC.SHOT_FREE];
    for (let k = 0; k < p.prevFires; k++) {
      const r = L.aReq + k * REQ_WORDS;
      if (b.A[r] === 0) continue;
      if (k >= free) {
        b.O[OH.SHOTS_REJECTED]++;
        continue;
      }
      const s = b.A[L.aShotFree + k];
      b.Pi[L.pPosX + s] = b.A[r + 1];
      b.Pi[L.pPosY + s] = b.A[r + 2];
      b.P[L.pVel + s] = b.A[r + 3];
      b.Pi[L.pDmg + s] = b.A[r + 4];
      b.P[L.pInfo + s] = (b.A[r + 5] | SHOT_ALIVE) >>> 0;
      b.P[L.pMeta + s] = 0;
      b.P[L.pLastHit + s] = NO_HIT;
      b.P[L.pSource + s] = b.A[r + 6];
    }
  }
}
