// @ts-check
// Pass 1: clears the per-tick scratch (bin counts, sums and cursors) and the outbound block. On a swarm
// reset (inbound flag bit 0) it first zeroes U, P and A whole, so the swarm after a reset is exactly a
// fresh one, like the new buffers after a device loss (docs/engine/05-gpu-swarm.md#resets-and-device-loss).
// Twin: kernels/clear.wgsl, with the reset encoded as clearBuffer commands by Swarm.encodeTick.

export class ClearPass {
  /** @param {import('./swarm-buffers.js').SwarmBuffers} b @param {import('./swarm-buffers.js').TickParams} p */
  static run(b, p) {
    const L = b.L;
    const cells = L.cells;
    if (p.flags & 1) {
      b.U.fill(0);
      b.P.fill(0);
      b.A.fill(0);
    }
    b.A.fill(0, L.aBinCount, L.aBinCount + cells);
    b.A.fill(0, L.aBinSumX, L.aBinSumX + cells);
    b.A.fill(0, L.aBinSumY, L.aBinSumY + cells);
    b.A.fill(0, L.aBinCursor, L.aBinCursor + cells);
    b.O.fill(0);
  }
}
