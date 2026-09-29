// Pass 13: targeting, policy `nearest`: one workgroup per fire command. Invocations split the cells in
// range, keep their best (distance², slot), and a tree reduction picks the minimum. The winner gets a
// shot request for the next tick. Twin: engine/swarm/reference/targeting.js.
#define O_ATOMIC
#include "swarm-common.wgsl"

var<workgroup> bestD: array<i32, WG>;
var<workgroup> bestS: array<u32, WG>;

@compute @workgroup_size(WG)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) lid: u32) {
  let k = wid.x;
  let f = TP.inBase + L.inFires + k * FIRE_WORDS;
  let range = I[f + 2u];
  let ox = I[f + 4u];
  let oy = I[f + 5u];
  let W = i32(L.gridW);
  let cr = (range >> L.cellShift) + 1;
  let cx = cellX(ox);
  let cy = cellY(oy);
  let x0 = max(cx - cr, 0);
  let x1 = min(cx + cr, W - 1);
  let y0 = max(cy - cr, 0);
  let y1 = min(cy + cr, W - 1);
  let span = u32(x1 - x0 + 1);
  let cells = span * u32(y1 - y0 + 1);
  let r2 = range * range;
  var bd = 0x7fffffff;
  var bs = 0xffffffffu;
  for (var n = lid; n < cells; n = n + WG) {
    let c = u32((y0 + i32(n / span)) * W + x0 + i32(n % span));
    let start = L.aBinEntries + u32(A[L.aBinStart + c]);
    let count = u32(A[L.aBinCount + c]);
    for (var e = 0u; e < count; e = e + 1u) {
      let j = u32(A[start + e]);
      if ((U[L.uInfo + j] & UNIT_ALIVE) == 0u) { continue; }
      let dx = bitcast<i32>(U[L.uPosX + j]) - ox;
      let dy = bitcast<i32>(U[L.uPosY + j]) - oy;
      if (dx > range || dx < -range || dy > range || dy < -range) { continue; }
      let d = dx * dx + dy * dy;
      if (d > r2) { continue; }
      if (d < bd || (d == bd && j < bs)) {
        bd = d;
        bs = j;
      }
    }
  }
  bestD[lid] = bd;
  bestS[lid] = bs;
  workgroupBarrier();
  for (var stride = WG >> 1u; stride > 0u; stride = stride >> 1u) {
    if (lid < stride) {
      let d = bestD[lid + stride];
      let s = bestS[lid + stride];
      if (d < bestD[lid] || (d == bestD[lid] && s < bestS[lid])) {
        bestD[lid] = d;
        bestS[lid] = s;
      }
    }
    workgroupBarrier();
  }
  if (lid != 0u) { return; }
  let r = L.aReq + k * REQ_WORDS;
  let best = bestS[0];
  if (best == 0xffffffffu) {
    A[r] = 0;
    return;
  }
  let shot = u32(I[f + 6u]);
  let aim = scaleTo(bitcast<i32>(U[L.uPosX + best]) - ox, bitcast<i32>(U[L.uPosY + best]) - oy, i32(shot & 0xffffu));
  A[r] = 1;
  A[r + 1u] = ox;
  A[r + 2u] = oy;
  A[r + 3u] = bitcast<i32>(packVel(aim.x, aim.y));
  A[r + 4u] = I[f + 3u];
  A[r + 5u] = i32(shot >> 16u) | (I[f + 1u] & 0xff0000);
  A[r + 6u] = I[f] & 0xffff;
  A[r + 7u] = 0;
  atomicOr(&O[L.oFireBits + (k >> 5u)], 1 << (k & 31u));
  atomicAdd(&O[OH_FIRED], 1);
}
