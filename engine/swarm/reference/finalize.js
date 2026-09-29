// @ts-check
// Pass 14: stamps the outbound header and reports the scrap carry. Twin: kernels/finalize.wgsl.
import { MISC, OH, OUT_MAGIC } from '../swarm-layout.js';

export class Finalize {
  /** @param {import('./swarm-buffers.js').SwarmBuffers} b @param {import('./swarm-buffers.js').TickParams} p */
  static run(b, p) {
    b.O[OH.MAGIC] = OUT_MAGIC;
    b.O[OH.TICK] = p.tick;
    b.O[OH.FLAGS] = p.flags;
    b.O[OH.SCRAP_CARRY] = b.A[b.L.aMisc + MISC.SCRAP_CARRY];
  }
}
