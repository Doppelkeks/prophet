// Pass 3b: last tick's drops → pickups. Drop k (slot order) takes free pickup slot k at the dead unit's
// position; drops beyond the free slots and the CPU's deposit join the scrap carry, which comes back as
// one merged gem near proxy 0 once a slot is free after the drops. Thread 0 owns the carry: when it
// spawns the merged gem, no drop was rejected, so nothing else touches the carry that tick.
// Twin: engine/swarm/reference/pickup-spawn.js.
#define A_ATOMIC
#include "swarm-common.wgsl"

@compute @workgroup_size(WG)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let k = gid.x;
  let free = atomicLoad(&A[L.aMisc + MISC_PICK_FREE]);
  let drops = atomicLoad(&A[L.aMisc + MISC_DROPS]);
  let carry = L.aMisc + MISC_SCRAP_CARRY;
  if (i32(k) < drops) {
    let i = u32(atomicLoad(&A[L.aDropReq + k]));
    let v = atomicLoad(&A[L.aDrop + i]);
    atomicStore(&A[L.aDrop + i], 0);
    if (i32(k) >= free) {
      atomicAdd(&A[carry], v);
    } else {
      let s = u32(atomicLoad(&A[L.aPickFree + k]));
      P[L.kPosX + s] = U[L.uPosX + i];
      P[L.kPosY + s] = U[L.uPosY + i];
      P[L.kValue + s] = bitcast<u32>(v);
      P[L.kInfo + s] = PICK_ALIVE;
    }
  }
  if (k != 0u) { return; }
  let deposit = I[TP.inBase + IH_SCRAP_IN];
  if (drops >= free) {
    atomicAdd(&A[carry], deposit);
    return;
  }
  let c = atomicLoad(&A[carry]) + deposit;
  atomicStore(&A[carry], c);
  if (c > 0 && TP.proxies > 0u) {
    let s = u32(atomicLoad(&A[L.aPickFree + u32(drops)]));
    let at = TP.inBase + L.inProxies;
    let half = i32(L.arenaHalf);
    P[L.kPosX + s] = bitcast<u32>(clamp(I[at + 1u], -half, half));
    P[L.kPosY + s] = bitcast<u32>(clamp(I[at + 2u] + i32(CARRY_OFFSET), -half, half));
    P[L.kValue + s] = bitcast<u32>(c);
    P[L.kInfo + s] = PICK_ALIVE;
    atomicStore(&A[carry], 0);
  }
}
