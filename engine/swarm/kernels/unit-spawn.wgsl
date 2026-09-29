// Pass 4: spawn groups → units. Request j finds its group by binary search over the CPU prefixes,
// takes free slot j, and gets its position on the ring from the stateless RNG.
// Twin: engine/swarm/reference/unit-spawn.js.
#define O_ATOMIC
#include "swarm-common.wgsl"

@compute @workgroup_size(WG)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let j = gid.x;
  if (j >= TP.requests) { return; }
  if (i32(j) >= A[L.aMisc + MISC_UNIT_FREE]) {
    atomicAdd(&O[OH_SPAWNS_REJECTED], 1);
    return;
  }
  let groups = TP.inBase + L.inGroups;
  var lo = 0;
  var hi = i32(TP.groups) - 1;
  loop {
    if (lo >= hi) { break; }
    let mid = (lo + hi + 1) >> 1u;
    if (I[groups + u32(mid) * GROUP_WORDS + 2u] <= i32(j)) { lo = mid; } else { hi = mid - 1; }
  }
  let g = groups + u32(lo) * GROUP_WORDS;
  let w0 = u32(I[g]);
  let ty = w0 & 0xffu;
  let mode = (w0 >> 8u) & 0xffu;
  let r0 = I[g + 6u];
  let r = r0 + i32(rng_below(rng_u32(L.keySpawnR, TP.tick, j), u32(I[g + 7u] - r0 + 1)));
  let angle = rng_u32(L.keySpawnA, TP.tick, j) & 0xffffu;
  let half = i32(L.arenaHalf);
  let x = clamp(I[g + 4u] + fx_mulShr(r, fx_cosB(angle), 14u), -half, half);
  let y = clamp(I[g + 5u] + fx_mulShr(r, fx_sinB(angle), 14u), -half, half);
  let phase = rng_u32(L.keyPhase, TP.tick, j) & 0xffu;
  let s = u32(A[L.aUnitFree + j]);
  U[L.uPosX + s] = bitcast<u32>(x);
  U[L.uPosY + s] = bitcast<u32>(y);
  U[L.uVel + s] = 0u;
  U[L.uAltGen + s] = (((U[L.uAltGen + s] >> 16u) + 1u) & 0xffffu) << 16u;
  U[L.uHp + s] = bitcast<u32>(fx_mulShr(T[L.tTypes + ty * TYPE_WORDS + TY_MAX_HP], I[g + 3u], 12u));
  U[L.uInfo + s] = ty | UNIT_ALIVE | (mode << 16u) | (phase << 24u);
  U[L.uSt0 + s] = 0u;
  U[L.uSt1 + s] = 0u;
}
