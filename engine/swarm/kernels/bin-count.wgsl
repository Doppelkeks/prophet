// Pass 5: count live units per 2 m bin, plus their positions inside the cell (for the dense centroid).
// Twin: engine/swarm/reference/bin-count.js.
#define A_ATOMIC
#include "swarm-common.wgsl"

@compute @workgroup_size(WG)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= L.unitCap || (U[L.uInfo + i] & UNIT_ALIVE) == 0u) { return; }
  let x = bitcast<i32>(U[L.uPosX + i]);
  let y = bitcast<i32>(U[L.uPosY + i]);
  let cx = cellX(x);
  let cy = cellY(y);
  let c = u32(cy * i32(L.gridW) + cx);
  let cellMax = (1 << L.cellShift) - 1;
  atomicAdd(&A[L.aBinCount + c], 1);
  atomicAdd(&A[L.aBinSumX + c], clamp(x - bitcast<i32>(L.originX) - (cx << L.cellShift), 0, cellMax));
  atomicAdd(&A[L.aBinSumY + c], clamp(y - bitcast<i32>(L.originY) - (cy << L.cellShift), 0, cellMax));
}
