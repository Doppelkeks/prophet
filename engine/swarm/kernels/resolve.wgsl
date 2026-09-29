// Pass 11: applies and clears each unit's accumulators; deaths bump the kill counters and may drop scrap
// (rand(DROP, tick, slot) against the type's chance). Twin: engine/swarm/reference/resolve.js.
#define O_ATOMIC
#include "swarm-common.wgsl"

@compute @workgroup_size(WG)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= L.unitCap) { return; }
  let dmg = A[L.aDmg + i];
  let credit = A[L.aKiller + i];
  A[L.aDmg + i] = 0;
  A[L.aKiller + i] = 0;
  A[L.aImpX + i] = 0;
  A[L.aImpY + i] = 0;
  A[L.aStApply + i] = 0;
  let info = U[L.uInfo + i];
  if ((info & UNIT_ALIVE) == 0u) { return; }
  let hp = bitcast<i32>(U[L.uHp + i]) - dmg;
  U[L.uHp + i] = bitcast<u32>(hp);
  if (hp > 0) {
    atomicAdd(&O[OH_UNITS_ALIVE], 1);
    return;
  }
  U[L.uInfo + i] = info & ~UNIT_ALIVE;
  atomicAdd(&O[OH_KILLS], 1);
  let ty = info & 0xffu;
  if (ty < L.typeCap) { atomicAdd(&O[L.oKillsType + ty], 1); }
  let source = u32(credit) & 0xffffu;
  if (credit > 0 && source < L.sourceCap) { atomicAdd(&O[L.oKillsSource + source], 1); }
  if (ty >= L.typeCap) { return; }
  let drop = bitcast<u32>(typeWord(info, TY_DROP));
  let value = drop >> 17u;
  if (value > 0u && rng_chance(rng_u32(L.keyDrop, TP.tick, i), drop & 0x1ffffu)) {
    A[L.aDrop + i] = i32(value);
    atomicAdd(&O[OH_SCRAP_DROPPED], i32(value));
  }
}
