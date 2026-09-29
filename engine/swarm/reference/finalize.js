// @ts-check
// Pass 14: stamps the outbound header. Twin: kernels/finalize.wgsl.
import { OH, OUT_MAGIC } from '../swarm-layout.js';

export class Finalize {
  /** @param {import('./swarm-buffers.js').SwarmBuffers} b @param {import('./swarm-buffers.js').TickParams} p */
  static run(b, p) {
    b.O[OH.MAGIC] = OUT_MAGIC;
    b.O[OH.TICK] = p.tick;
    b.O[OH.FLAGS] = p.flags;
  }
}
