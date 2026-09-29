// Pass 11: applies and clears each unit's accumulators: status timers (step damage, then this tick's tiers),
// Marked's extra damage, knockback, deaths with kill counters, scrap drops (rand(DROP, tick, slot) against
// the type's chance) and UNIT_DIED events for report types. Twin: engine/swarm/reference/resolve.js.
#define O_ATOMIC
#include "swarm-common.wgsl"

fn emitDeath(i: u32, ty: u32, source: u32) {
  let k = u32(atomicAdd(&O[OH_EVENTS], 1));
  if (k >= L.eventCap) {
    atomicOr(&O[OH_EVENT_OVERFLOW], i32(EVENT_CLASS_GAMEPLAY));
    return;
  }
  let at = L.oEvents + k * EVENT_WORDS;
  atomicStore(&O[at], i32(EVENT_UNIT_DIED | (EVENT_CLASS_GAMEPLAY << 8u) | (ty << 16u)));
  atomicStore(&O[at + 1u], bitcast<i32>((i & 0xffffffu) | ((U[L.uAltGen + i] >> 16u) << 24u)));
  atomicStore(&O[at + 2u], i32(source));
  let px = bitcast<u32>(bitcast<i32>(U[L.uPosX + i]) >> 6u) & 0xffffu;
  let py = bitcast<u32>(bitcast<i32>(U[L.uPosY + i]) >> 6u) << 16u;
  atomicStore(&O[at + 3u], bitcast<i32>(px | py));
}

@compute @workgroup_size(WG)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= L.unitCap) { return; }
  var dmg = A[L.aDmg + i];
  let credit = A[L.aKiller + i];
  let impX = A[L.aImpX + i];
  let impY = A[L.aImpY + i];
  let apply = bitcast<u32>(A[L.aStApply + i]);
  A[L.aDmg + i] = 0;
  A[L.aKiller + i] = 0;
  A[L.aImpX + i] = 0;
  A[L.aImpY + i] = 0;
  A[L.aStApply + i] = 0;
  let info = U[L.uInfo + i];
  if ((info & UNIT_ALIVE) == 0u) { return; }
  let ty = info & 0xffu;
  let flags = bitcast<u32>(typeWord(info, TY_FLAGS));
  let immune = (flags >> 8u) & 0xffu;
  let step = (TP.tick & (STATUS_STEP - 1u)) == 0u;
  var st0 = U[L.uSt0 + i];
  var st1 = U[L.uSt1 + i];
  if ((st1 & 0xffu) != 0u) { dmg = dmg + (dmg >> 2u); } // Marked
  var extra = 0;
  for (var s = 0u; s < 8u; s = s + 1u) {
    let sh = (s & 3u) << 3u;
    var word = st0;
    if (s >= 4u) { word = st1; }
    var t = (word >> sh) & 0xffu;
    let entry = L.tStatus + s * STATUS_WORDS;
    if (step && t > 0u) {
      t = t - 1u;
      extra = extra + T[entry + 1u];
    }
    let code = (apply >> (s * 3u)) & 7u;
    if (code != 0u && (immune & (1u << s)) == 0u) {
      var tier = 1u;
      if ((code & 4u) != 0u) { tier = 3u; } else if ((code & 2u) != 0u) { tier = 2u; }
      let d = (bitcast<u32>(T[entry]) >> ((tier - 1u) << 3u)) & 0xffu;
      if (d > t) { t = d; }
    }
    let next = (word & ~(0xffu << sh)) | (t << sh);
    if (s < 4u) { st0 = next; } else { st1 = next; }
  }
  U[L.uSt0 + i] = st0;
  U[L.uSt1 + i] = st1;
  let kb = (bitcast<u32>(typeWord(info, TY_TIMING)) >> 8u) & 0xffu;
  if ((impX != 0 || impY != 0) && kb < 255u) {
    let v = U[L.uVel + i];
    let m = i32(MAX_IMPULSE);
    let ix = clamp(impX, -m, m);
    let iy = clamp(impY, -m, m);
    let vx = clamp(lo16(v) + ((ix * (256 - i32(kb))) >> 8u), -m, m);
    let vy = clamp(hi16(v) + ((iy * (256 - i32(kb))) >> 8u), -m, m);
    U[L.uVel + i] = packVel(vx, vy);
  }
  let hp = bitcast<i32>(U[L.uHp + i]) - dmg - extra;
  U[L.uHp + i] = bitcast<u32>(hp);
  if (hp > 0) {
    atomicAdd(&O[OH_UNITS_ALIVE], 1);
    return;
  }
  U[L.uInfo + i] = info & ~UNIT_ALIVE;
  atomicAdd(&O[OH_KILLS], 1);
  if (ty < L.typeCap) { atomicAdd(&O[L.oKillsType + ty], 1); }
  let source = u32(credit) & 0xffffu;
  if (credit > 0 && source < L.sourceCap) { atomicAdd(&O[L.oKillsSource + source], 1); }
  if (ty >= L.typeCap) { return; }
  if ((flags & UNIT_REPORT) != 0u) { emitDeath(i, ty, select(0xffffu, source, credit > 0)); }
  let drop = bitcast<u32>(typeWord(info, TY_DROP));
  let value = drop >> 17u;
  if (value > 0u && rng_chance(rng_u32(L.keyDrop, TP.tick, i), drop & 0x1ffffu)) {
    A[L.aDrop + i] = i32(value);
    atomicAdd(&O[OH_SCRAP_DROPPED], i32(value));
  }
}
