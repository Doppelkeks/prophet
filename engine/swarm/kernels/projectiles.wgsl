// Pass 10: shots move, then hit the nearest live unit by (distance², slot) in the 3×3 bins, skipping
// their last hit. Damage and kill credit go into per-unit atomics. Twin: engine/swarm/reference/projectiles.js.
#define A_ATOMIC
#define O_ATOMIC
#include "swarm-common.wgsl"

@compute @workgroup_size(WG)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let s = gid.x;
  if (s >= L.shotCap) { return; }
  let info = P[L.pInfo + s];
  if ((info & SHOT_ALIVE) == 0u) { return; }
  let v = P[L.pVel + s];
  let x = bitcast<i32>(P[L.pPosX + s]) + lo16(v);
  let y = bitcast<i32>(P[L.pPosY + s]) + hi16(v);
  P[L.pPosX + s] = bitcast<u32>(x);
  P[L.pPosY + s] = bitcast<u32>(y);
  let last = P[L.pLastHit + s];
  let W = i32(L.gridW);
  let cx = cellX(x);
  let cy = cellY(y);
  var bestD = 0x7fffffff;
  var best = 0xffffffffu;
  for (var oy = -1; oy <= 1; oy = oy + 1) {
    let ny = cy + oy;
    if (ny < 0 || ny >= W) { continue; }
    for (var ox = -1; ox <= 1; ox = ox + 1) {
      let nx = cx + ox;
      if (nx < 0 || nx >= W) { continue; }
      let c = u32(ny * W + nx);
      let start = L.aBinEntries + u32(atomicLoad(&A[L.aBinStart + c]));
      let count = u32(atomicLoad(&A[L.aBinCount + c]));
      for (var e = 0u; e < count; e = e + 1u) {
        let j = u32(atomicLoad(&A[start + e]));
        if (j == last) { continue; }
        let uinfo = U[L.uInfo + j];
        if ((uinfo & UNIT_ALIVE) == 0u) { continue; }
        let r = i32(SHOT_RADIUS) + typeWord(uinfo, TY_RADIUS);
        let dx = bitcast<i32>(U[L.uPosX + j]) - x;
        let dy = bitcast<i32>(U[L.uPosY + j]) - y;
        if (dx > r || dx < -r || dy > r || dy < -r) { continue; }
        let d = dx * dx + dy * dy;
        if (d > r * r) { continue; }
        if (d < bestD || (d == bestD && j < best)) {
          bestD = d;
          best = j;
        }
      }
    }
  }
  let life = i32(info & 0xffffu) - 1;
  var pierce = (info >> 16u) & 0xffu;
  var alive = life > 0;
  if (best != 0xffffffffu) {
    let dmg = bitcast<i32>(P[L.pDmg + s]);
    atomicAdd(&A[L.aDmg + best], dmg);
    let credit = ((min(dmg >> 8u, 0x7ffe) + 1) << 16u) | i32(P[L.pSource + s] & 0xffffu);
    atomicMax(&A[L.aKiller + best], credit);
    P[L.pLastHit + s] = best;
    if (pierce == 0u) { alive = false; } else { pierce = pierce - 1u; }
  }
  if (!alive) {
    P[L.pInfo + s] = 0u;
    return;
  }
  atomicAdd(&O[OH_SHOTS_ALIVE], 1);
  P[L.pInfo + s] = u32(life) | (pierce << 16u) | SHOT_ALIVE;
}
