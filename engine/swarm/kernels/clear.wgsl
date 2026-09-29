// Pass 1: clears bins and the outbound block; on a swarm reset also empties the pools.
// Twin: engine/swarm/reference/clear-pass.js.
#include "swarm-common.wgsl"

@compute @workgroup_size(WG)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i < L.cells) {
    A[L.aBinCount + i] = 0;
    A[L.aBinSumX + i] = 0;
    A[L.aBinSumY + i] = 0;
    A[L.aBinCursor + i] = 0;
  }
  if (i < L.outWords) { O[i] = 0; }
  if ((TP.flags & 1u) != 0u) {
    if (i < L.unitCap) { U[L.uInfo + i] = 0u; }
    if (i < L.shotCap) { P[L.pInfo + i] = 0u; }
    if (i < L.fireCap) { A[L.aReq + i * REQ_WORDS] = 0; }
  }
}
