// @ts-check
// Pass 6: exclusive prefix sum over the bin counts gives each cell's start in the entry list.
// Twin: kernels/scan.wgsl (count variant; a workgroup scan on the GPU, same integers).
export class BinScan {
  /** @param {import('./swarm-buffers.js').SwarmBuffers} b */
  static run(b) {
    const L = b.L;
    let sum = 0;
    for (let c = 0; c < L.cells; c++) {
      b.A[L.aBinStart + c] = sum;
      sum += b.A[L.aBinCount + c];
    }
  }
}
