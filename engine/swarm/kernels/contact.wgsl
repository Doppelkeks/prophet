// Pass 12: contact damage on player proxies, one workgroup per proxy; each unit strikes on its type's
// cadence, unless stunned. The per-proxy sums commute. Twin: engine/swarm/reference/contact.js.
#define O_ATOMIC
#include "swarm-common.wgsl"

var<workgroup> total: atomic<i32>;
var<workgroup> hits: atomic<i32>;
var<workgroup> starts: array<u32, 9>;
var<workgroup> counts: array<u32, 9>;

@compute @workgroup_size(WG)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) lid: u32) {
  let k = wid.x;
  let q = TP.inBase + L.inProxies + k * PROXY_WORDS;
  let player = (bitcast<u32>(I[q + 4u]) & 0xffu) == PLAYER_TEAM;
  let qx = I[q + 1u];
  let qy = I[q + 2u];
  let qr = I[q + 3u];
  let W = i32(L.gridW);
  let cx = cellX(qx);
  let cy = cellY(qy);
  if (lid == 0u) {
    atomicStore(&total, 0);
    atomicStore(&hits, 0);
    for (var n = 0u; n < 9u; n = n + 1u) {
      let nx = cx + i32(n % 3u) - 1;
      let ny = cy + i32(n / 3u) - 1;
      if (nx < 0 || nx >= W || ny < 0 || ny >= W) {
        counts[n] = 0u;
        starts[n] = 0u;
      } else {
        let c = u32(ny * W + nx);
        counts[n] = u32(A[L.aBinCount + c]);
        starts[n] = u32(A[L.aBinStart + c]);
      }
    }
  }
  workgroupBarrier();
  if (player) {
    for (var n = 0u; n < 9u; n = n + 1u) {
      for (var e = lid; e < counts[n]; e = e + WG) {
        let j = u32(A[L.aBinEntries + starts[n] + e]);
        let info = U[L.uInfo + j];
        if ((info & UNIT_ALIVE) == 0u) { continue; }
        if ((U[L.uSt0 + j] >> 24u) != 0u) { continue; }
        let r = qr + typeWord(info, TY_RADIUS);
        let dx = bitcast<i32>(U[L.uPosX + j]) - qx;
        let dy = bitcast<i32>(U[L.uPosY + j]) - qy;
        if (dx > r || dx < -r || dy > r || dy < -r) { continue; }
        if (dx * dx + dy * dy > r * r) { continue; }
        if (fx_umod(TP.tick + (info >> 24u), u32(typeWord(info, TY_TIMING)) & 0xffu) != 0u) { continue; }
        atomicAdd(&total, typeWord(info, TY_CONTACT));
        atomicAdd(&hits, 1);
      }
    }
  }
  workgroupBarrier();
  if (lid == 0u && player) {
    atomicAdd(&O[L.oProxyDmg + k], atomicLoad(&total));
    atomicAdd(&O[OH_CONTACT_HITS], atomicLoad(&hits));
  }
}
