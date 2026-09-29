// Passes 2 and 6: three-level exclusive scan (blocks of SCAN_BLOCK elements, then the block sums, then
// apply). MODE 0 lists free unit slots, MODE 1 free shot slots, MODE 3 free pickup slots (ascending),
// MODE 4 the units that dropped scrap (slot order); MODE 2 turns bin counts into bin starts.
// Twins: reference/free-scan.js and reference/bin-scan.js (same integers, any order).
#include "swarm-common.wgsl"

override MODE: u32 = 0u;

var<workgroup> part: array<u32, WG>;

fn count() -> u32 {
  if (MODE == 0u || MODE == 4u) { return L.unitCap; }
  if (MODE == 1u) { return L.shotCap; }
  if (MODE == 3u) { return L.pickCap; }
  return L.cells;
}

fn value(i: u32) -> u32 {
  if (MODE == 0u) { return select(0u, 1u, i < L.unitCap && (U[L.uInfo + i] & UNIT_ALIVE) == 0u); }
  if (MODE == 1u) { return select(0u, 1u, i < L.shotCap && (P[L.pInfo + i] & SHOT_ALIVE) == 0u); }
  if (MODE == 3u) { return select(0u, 1u, i < L.pickCap && (P[L.kInfo + i] & PICK_ALIVE) == 0u); }
  if (MODE == 4u) {
    if (i < L.unitCap) { return select(0u, 1u, A[L.aDrop + i] != 0); }
    return 0u;
  }
  if (i < L.cells) { return u32(A[L.aBinCount + i]); }
  return 0u;
}

fn list() -> u32 {
  if (MODE == 0u) { return L.aUnitFree; }
  if (MODE == 1u) { return L.aShotFree; }
  if (MODE == 3u) { return L.aPickFree; }
  return L.aDropReq;
}

// Thread 0 turns part[] into exclusive offsets; returns the total to everyone.
var<workgroup> total: u32;
fn scanPart(lid: u32) {
  workgroupBarrier();
  if (lid == 0u) {
    var acc = 0u;
    for (var k = 0u; k < WG; k = k + 1u) {
      let v = part[k];
      part[k] = acc;
      acc = acc + v;
    }
    total = acc;
  }
  workgroupBarrier();
}

@compute @workgroup_size(WG)
fn blocks(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) lid: u32) {
  let n = count();
  let per = SCAN_BLOCK / WG;
  let base = wid.x * SCAN_BLOCK + lid * per;
  var sum = 0u;
  for (var k = 0u; k < per; k = k + 1u) { sum = sum + value(base + k); }
  part[lid] = sum;
  scanPart(lid);
  if (lid == 0u) { A[L.aScan + wid.x] = i32(total); }
  var off = part[lid];
  for (var k = 0u; k < per; k = k + 1u) {
    let i = base + k;
    if (i < n) {
      A[L.aScanTmp + i] = i32(off);
      off = off + value(i);
    }
  }
}

@compute @workgroup_size(WG)
fn sums(@builtin(local_invocation_index) lid: u32) {
  let n = count();
  let nb = (n + SCAN_BLOCK - 1u) / SCAN_BLOCK;
  let per = (nb + WG - 1u) / WG;
  let base = lid * per;
  var sum = 0u;
  for (var k = 0u; k < per; k = k + 1u) {
    if (base + k < nb) { sum = sum + u32(A[L.aScan + base + k]); }
  }
  part[lid] = sum;
  scanPart(lid);
  var off = part[lid];
  for (var k = 0u; k < per; k = k + 1u) {
    let b = base + k;
    if (b < nb) {
      let v = u32(A[L.aScan + b]);
      A[L.aScan + b] = i32(off);
      off = off + v;
    }
  }
  if (lid == 0u) {
    if (MODE == 0u) { A[L.aMisc + MISC_UNIT_FREE] = i32(total); }
    if (MODE == 1u) { A[L.aMisc + MISC_SHOT_FREE] = i32(total); }
    if (MODE == 3u) { A[L.aMisc + MISC_PICK_FREE] = i32(total); }
    if (MODE == 4u) { A[L.aMisc + MISC_DROPS] = i32(total); }
  }
}

@compute @workgroup_size(WG)
fn apply(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= count()) { return; }
  let g = u32(A[L.aScanTmp + i]) + u32(A[L.aScan + i / SCAN_BLOCK]);
  if (MODE == 2u) {
    A[L.aBinStart + i] = i32(g);
  } else if (value(i) == 1u) {
    A[list() + g] = i32(i);
  }
}
