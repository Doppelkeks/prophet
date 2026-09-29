// Pass 10b: area effects, one workgroup per effect. The invocations split the cells under the effect's
// bounding box; every unit inside the shape (circle, or ring between two radii) gets the damage and kill
// credit, a radial impulse and the status tier, through commuting atomics.
// Twin: engine/swarm/reference/effects.js.
#define A_ATOMIC
#include "swarm-common.wgsl"

@compute @workgroup_size(WG)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) lid: u32) {
  let e = wid.x;
  if (e >= TP.effects) { return; }
  let at = TP.inBase + L.inEffects + e * EFFECT_WORDS;
  let w0 = bitcast<u32>(I[at]);
  if (((w0 >> 8u) & 0xffu) != PLAYER_TEAM) { return; }
  let ring = (w0 & 0xffu) == EFFECT_RING;
  let status = (w0 >> 16u) & 0xffu;
  let tier = w0 >> 24u;
  let ex = I[at + 1u];
  let ey = I[at + 2u];
  let r = I[at + 3u];
  let inner = I[at + 4u];
  let dmg = I[at + 5u];
  let imp = I[at + 6u];
  var code = 0;
  if (tier > 0u) { code = i32(((1u << tier) - 1u) << (status * 3u)); }
  var credit = 0;
  if (dmg > 0) { credit = ((min(dmg >> 8u, 0x7ffe) + 1) << 16u) | (I[at + 7u] & 0xffff); }
  let x0 = cellX(ex - r);
  let x1 = cellX(ex + r);
  let y0 = cellY(ey - r);
  let y1 = cellY(ey + r);
  let w = u32(x1 - x0 + 1);
  let cells = w * u32(y1 - y0 + 1);
  let W = u32(L.gridW);
  for (var k = lid; k < cells; k = k + WG) {
    let c = (u32(y0) + k / w) * W + u32(x0) + k % w;
    let start = L.aBinEntries + u32(atomicLoad(&A[L.aBinStart + c]));
    let count = u32(atomicLoad(&A[L.aBinCount + c]));
    for (var n = 0u; n < count; n = n + 1u) {
      let j = u32(atomicLoad(&A[start + n]));
      if ((U[L.uInfo + j] & UNIT_ALIVE) == 0u) { continue; }
      let dx = bitcast<i32>(U[L.uPosX + j]) - ex;
      let dy = bitcast<i32>(U[L.uPosY + j]) - ey;
      if (dx > r || dx < -r || dy > r || dy < -r) { continue; }
      let d = dx * dx + dy * dy;
      if (d > r * r) { continue; }
      if (ring && d < inner * inner) { continue; }
      if (dmg != 0) { atomicAdd(&A[L.aDmg + j], dmg); }
      if (credit != 0) { atomicMax(&A[L.aKiller + j], credit); }
      if (imp != 0) {
        let push = scaleTo(dx, dy, imp);
        atomicAdd(&A[L.aImpX + j], push.x);
        atomicAdd(&A[L.aImpY + j], push.y);
      }
      if (code != 0) { atomicOr(&A[L.aStApply + j], code); }
    }
  }
}
