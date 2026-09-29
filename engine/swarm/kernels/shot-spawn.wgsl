// Pass 3: shot requests of the previous tick → shots. Request k takes free shot slot k.
// Twin: engine/swarm/reference/shot-spawn.js.
#define O_ATOMIC
#include "swarm-common.wgsl"

@compute @workgroup_size(WG)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let k = gid.x;
  if (k >= TP.prevFires) { return; }
  let r = L.aReq + k * REQ_WORDS;
  if (A[r] == 0) { return; }
  if (i32(k) >= A[L.aMisc + MISC_SHOT_FREE]) {
    atomicAdd(&O[OH_SHOTS_REJECTED], 1);
    return;
  }
  let s = u32(A[L.aShotFree + k]);
  P[L.pPosX + s] = bitcast<u32>(A[r + 1u]);
  P[L.pPosY + s] = bitcast<u32>(A[r + 2u]);
  P[L.pVel + s] = bitcast<u32>(A[r + 3u]);
  P[L.pDmg + s] = bitcast<u32>(A[r + 4u]);
  P[L.pInfo + s] = bitcast<u32>(A[r + 5u]) | SHOT_ALIVE;
  P[L.pMeta + s] = 0u;
  P[L.pLastHit + s] = NO_HIT;
  P[L.pSource + s] = bitcast<u32>(A[r + 6u]);
}
