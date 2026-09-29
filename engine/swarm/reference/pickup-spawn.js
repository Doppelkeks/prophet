// @ts-check
// Pass 3b: last tick's drops become pickups. Drop k (in slot order) takes free pickup slot k, at the dead
// unit's last position, before this tick's unit spawn can reuse that slot. Drops beyond the free slots,
// and scrap the CPU deposits, join the scrap carry; when a slot is free after the drops, the whole carry
// comes back as one merged gem near proxy 0. No scrap is ever lost (docs/engine/05-gpu-swarm.md#pass-chain).
// Twin: kernels/pickup-spawn.wgsl.
import { Fixed } from '../../core/fixed.js';
import { IH, MISC, PICK_ALIVE } from '../swarm-layout.js';

/** Where a merged gem appears: 2 m north of proxy 0. */
export const CARRY_OFFSET = 2048;

export class PickupSpawn {
  /** @param {import('./swarm-buffers.js').SwarmBuffers} b @param {import('./swarm-buffers.js').TickParams} p */
  static run(b, p) {
    const L = b.L;
    const free = b.A[L.aMisc + MISC.PICK_FREE];
    const drops = b.A[L.aMisc + MISC.DROPS];
    const carry = L.aMisc + MISC.SCRAP_CARRY;
    for (let k = 0; k < drops; k++) {
      const i = b.A[L.aDropReq + k];
      const v = b.A[L.aDrop + i];
      b.A[L.aDrop + i] = 0;
      if (k >= free) {
        b.A[carry] += v;
        continue;
      }
      const s = b.A[L.aPickFree + k];
      b.Pi[L.kPosX + s] = b.Ui[L.uPosX + i];
      b.Pi[L.kPosY + s] = b.Ui[L.uPosY + i];
      b.P[L.kValue + s] = v;
      b.P[L.kInfo + s] = PICK_ALIVE;
    }
    b.A[carry] += b.I[p.inBase + IH.SCRAP_IN];
    if (drops < free && b.A[carry] > 0 && p.proxies > 0) {
      const s = b.A[L.aPickFree + drops];
      const at = p.inBase + L.inProxies;
      const half = L.arenaHalf;
      b.Pi[L.kPosX + s] = Fixed.clamp(b.I[at + 1], -half, half);
      b.Pi[L.kPosY + s] = Fixed.clamp(b.I[at + 2] + CARRY_OFFSET, -half, half);
      b.P[L.kValue + s] = b.A[carry];
      b.P[L.kInfo + s] = PICK_ALIVE;
      b.A[carry] = 0;
    }
  }
}
