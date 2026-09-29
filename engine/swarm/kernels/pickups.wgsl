// Pass 13b: pickups fly to the nearest collector whose magnet radius holds them (ties to the lower proxy
// index) and are collected on touching it, into exact per-proxy and total counters.
// Twin: engine/swarm/reference/pickups.js.
#define O_ATOMIC
#include "swarm-common.wgsl"

@compute @workgroup_size(WG)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let s = gid.x;
  if (s >= L.pickCap) { return; }
  let info = P[L.kInfo + s];
  if ((info & PICK_ALIVE) == 0u) { return; }
  let x = bitcast<i32>(P[L.kPosX + s]);
  let y = bitcast<i32>(P[L.kPosY + s]);
  let base = TP.inBase + L.inProxies;
  var best = -1;
  var bestD = 0x7fffffff;
  for (var q = 0u; q < TP.proxies; q = q + 1u) {
    let at = base + q * PROXY_WORDS;
    if ((((bitcast<u32>(I[at + 4u]) >> 16u) & 0xffu) & PROXY_COLLECTOR) == 0u) { continue; }
    let mag = I[at + 6u];
    let dx = I[at + 1u] - x;
    let dy = I[at + 2u] - y;
    if (dx > mag || dx < -mag || dy > mag || dy < -mag) { continue; }
    let d = dx * dx + dy * dy;
    if (d > mag * mag) { continue; }
    if (d < bestD) {
      bestD = d;
      best = i32(q);
    }
  }
  if (best >= 0) {
    let at = base + u32(best) * PROXY_WORDS;
    let r = I[at + 3u] + i32(PICKUP_RADIUS);
    if (bestD <= r * r) {
      let v = bitcast<i32>(P[L.kValue + s]);
      atomicAdd(&O[L.oProxyScrap + u32(best)], v);
      atomicAdd(&O[OH_SCRAP_COLLECTED], v);
      P[L.kInfo + s] = 0u;
      return;
    }
    let step = scaleTo(I[at + 1u] - x, I[at + 2u] - y, i32(MAGNET_SPEED));
    let half = i32(L.arenaHalf);
    P[L.kPosX + s] = bitcast<u32>(clamp(x + step.x, -half, half));
    P[L.kPosY + s] = bitcast<u32>(clamp(y + step.y, -half, half));
  }
  let age = info >> 16u;
  P[L.kInfo + s] = (info & 0xffffu) | (select(age, age + 1u, age < 0xffffu) << 16u);
  atomicAdd(&O[OH_PICKUPS_ALIVE], 1);
}
