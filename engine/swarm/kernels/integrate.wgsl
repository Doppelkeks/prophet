// Pass 9: fixed-point integration, clamped to the arena; the x step, then the y step, is refused (and that
// velocity component zeroed) if it would enter a blocked cell. Twin: engine/swarm/reference/integrate.js.
#include "swarm-common.wgsl"

@compute @workgroup_size(WG)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= L.unitCap || (U[L.uInfo + i] & UNIT_ALIVE) == 0u) { return; }
  let v = U[L.uVel + i];
  var vx = lo16(v);
  var vy = hi16(v);
  let half = i32(L.arenaHalf);
  let x0 = bitcast<i32>(U[L.uPosX + i]);
  let y0 = bitcast<i32>(U[L.uPosY + i]);
  var x = clamp(x0 + vx, -half, half);
  if (blocked(cellX(x), cellY(y0))) {
    x = x0;
    vx = 0;
  }
  var y = clamp(y0 + vy, -half, half);
  if (blocked(cellX(x), cellY(y))) {
    y = y0;
    vy = 0;
  }
  U[L.uPosX + i] = bitcast<u32>(x);
  U[L.uPosY + i] = bitcast<u32>(y);
  U[L.uVel + i] = packVel(vx, vy);
}
