// Pass 7: every live unit writes its slot into its cell's range. The order inside a cell depends on
// atomic timing; every consumer is order-independent. Twin: engine/swarm/reference/bin-scatter.js.
#define A_ATOMIC
#include "swarm-common.wgsl"

@compute @workgroup_size(WG)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= L.unitCap || (U[L.uInfo + i] & UNIT_ALIVE) == 0u) { return; }
  let c = u32(cellY(bitcast<i32>(U[L.uPosY + i])) * i32(L.gridW) + cellX(bitcast<i32>(U[L.uPosX + i])));
  let at = atomicAdd(&A[L.aBinCursor + c], 1);
  atomicStore(&A[L.aBinEntries + u32(atomicLoad(&A[L.aBinStart + c]) + at)], i32(i));
}
