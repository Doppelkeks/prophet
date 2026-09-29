// Pass 13: targeting, one workgroup per fire command. Invocations split the cells in range and keep their best
// (key, slot); a tree reduction picks the minimum. Keys: distance² (NEAREST, CHAIN) or −HP (STRONGEST), plus
// MARK_PENALTY for unmarked units under PREFER_MARKED. AIMED fires along the command's angle. CHAIN strikes
// its pick at once and then bounces: each jump reduces over the cells around the last target, skipping the
// units the chain already hit. Twin: engine/swarm/reference/targeting.js.
#define A_ATOMIC
#define O_ATOMIC
#include "swarm-common.wgsl"

var<workgroup> bestK: array<i32, WG>;
var<workgroup> bestS: array<u32, WG>;
var<workgroup> hits: array<u32, 9>; // MAX_BOUNCES + 1
var<workgroup> nHits: u32;

/** Every invocation scans its share of the cells within `range` of (ox, oy); then the workgroup reduces. */
fn search(lid: u32, ox: i32, oy: i32, range: i32, strongest: bool, preferMarked: bool, masked: u32) {
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
  var bk = 0x7fffffff;
  var bs = 0xffffffffu;
  for (var n = lid; n < cells; n = n + WG) {
    let c = u32((y0 + i32(n / span)) * W + x0 + i32(n % span));
    let start = L.aBinEntries + u32(atomicLoad(&A[L.aBinStart + c]));
    let count = u32(atomicLoad(&A[L.aBinCount + c]));
    for (var e = 0u; e < count; e = e + 1u) {
      let j = u32(atomicLoad(&A[start + e]));
      if ((U[L.uInfo + j] & UNIT_ALIVE) == 0u) { continue; }
      let dx = bitcast<i32>(U[L.uPosX + j]) - ox;
      let dy = bitcast<i32>(U[L.uPosY + j]) - oy;
      if (dx > range || dx < -range || dy > range || dy < -range) { continue; }
      let d = dx * dx + dy * dy;
      if (d > r2) { continue; }
      var hit = false;
      for (var m = 0u; m < masked; m = m + 1u) { if (hits[m] == j) { hit = true; } }
      if (hit) { continue; }
      var key = d;
      if (strongest) { key = -bitcast<i32>(U[L.uHp + j]); }
      if (preferMarked && (U[L.uSt1 + j] & 0xffu) == 0u) { key = key + i32(MARK_PENALTY); }
      if (key < bk || (key == bk && j < bs)) {
        bk = key;
        bs = j;
      }
    }
  }
  bestK[lid] = bk;
  bestS[lid] = bs;
  workgroupBarrier();
  for (var stride = WG >> 1u; stride > 0u; stride = stride >> 1u) {
    if (lid < stride) {
      let k = bestK[lid + stride];
      let s = bestS[lid + stride];
      if (k < bestK[lid] || (k == bestK[lid] && s < bestS[lid])) {
        bestK[lid] = k;
        bestS[lid] = s;
      }
    }
    workgroupBarrier();
  }
}

fn strike(j: u32, dmg: i32, source: i32) {
  atomicAdd(&A[L.aDmg + j], dmg);
  atomicMax(&A[L.aKiller + j], ((min(dmg >> 8u, 0x7ffe) + 1) << 16u) | source);
}

fn request(k: u32, f: u32, vx: i32, vy: i32) {
  let r = L.aReq + k * REQ_WORDS;
  let shot = u32(I[f + 6u]);
  atomicStore(&A[r], 1);
  atomicStore(&A[r + 1u], I[f + 4u]);
  atomicStore(&A[r + 2u], I[f + 5u]);
  atomicStore(&A[r + 3u], bitcast<i32>(packVel(vx, vy)));
  atomicStore(&A[r + 4u], I[f + 3u]);
  atomicStore(&A[r + 5u], i32(shot >> 16u) | (I[f + 1u] & 0xff0000));
  atomicStore(&A[r + 6u], I[f] & 0xffff);
  atomicStore(&A[r + 7u], 0);
  atomicOr(&O[L.oFireBits + (k >> 5u)], 1 << (k & 31u));
  atomicAdd(&O[OH_FIRED], 1);
}

@compute @workgroup_size(WG)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) lid: u32) {
  let k = wid.x;
  let f = TP.inBase + L.inFires + k * FIRE_WORDS;
  let w0 = bitcast<u32>(I[f]);
  let policy = (w0 >> 16u) & 0xffu;
  let flags = w0 >> 24u;
  let range = I[f + 2u];
  let ox = I[f + 4u];
  let oy = I[f + 5u];
  let shot = u32(I[f + 6u]);
  if (policy == POLICY_AIMED) {
    if (lid == 0u) {
      let a = u32(I[f + 7u]) & 0xffffu;
      let speed = i32(shot & 0xffffu);
      request(k, f, fx_mulShr(speed, fx_cosB(a), 14u), fx_mulShr(speed, fx_sinB(a), 14u));
    }
    return;
  }
  search(lid, ox, oy, range, policy == POLICY_STRONGEST, (flags & FIRE_PREFER_MARKED) != 0u, 0u);
  let best = workgroupUniformLoad(&bestS[0]);
  if (best == 0xffffffffu) {
    if (lid == 0u) { atomicStore(&A[L.aReq + k * REQ_WORDS], 0); }
    return;
  }
  if (policy != POLICY_CHAIN) {
    if (lid == 0u) {
      let aim = scaleTo(bitcast<i32>(U[L.uPosX + best]) - ox, bitcast<i32>(U[L.uPosY + best]) - oy, i32(shot & 0xffffu));
      request(k, f, aim.x, aim.y);
    }
    return;
  }
  let source = i32(w0 & 0xffffu);
  let falloff = I[f + 1u] & 0x1ff;
  let bounces = (u32(I[f + 7u]) >> 16u) & 0xffu;
  var dmg = I[f + 3u];
  if (lid == 0u) {
    atomicStore(&A[L.aReq + k * REQ_WORDS], 0); // no shot: the chain strikes now
    strike(best, dmg, source);
    hits[0] = best;
    nHits = 1u;
    atomicOr(&O[L.oFireBits + (k >> 5u)], 1 << (k & 31u));
    atomicAdd(&O[OH_FIRED], 1);
  }
  for (var jump = 0u; jump < bounces; jump = jump + 1u) {
    dmg = (dmg * falloff) >> 8u;
    let n = workgroupUniformLoad(&nHits);
    let last = hits[n - 1u];
    search(lid, bitcast<i32>(U[L.uPosX + last]), bitcast<i32>(U[L.uPosY + last]), i32(CHAIN_RANGE), false, false, n);
    if (lid == 0u) {
      let next = bestS[0];
      if (next != 0xffffffffu) {
        strike(next, dmg, source);
        hits[n] = next;
        nHits = n + 1u;
      }
    }
    workgroupBarrier();
  }
}
