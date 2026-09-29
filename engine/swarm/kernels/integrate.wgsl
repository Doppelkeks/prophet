// Pass 9: fixed-point integration, clamped to the arena. Twin: engine/swarm/reference/integrate.js.
#include "swarm-common.wgsl"

@compute @workgroup_size(WG)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= L.unitCap || (U[L.uInfo + i] & UNIT_ALIVE) == 0u) { return; }
  let v = U[L.uVel + i];
  let half = i32(L.arenaHalf);
  U[L.uPosX + i] = bitcast<u32>(clamp(bitcast<i32>(U[L.uPosX + i]) + lo16(v), -half, half));
  U[L.uPosY + i] = bitcast<u32>(clamp(bitcast<i32>(U[L.uPosY + i]) + hi16(v), -half, half));
}
