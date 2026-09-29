// @ts-check
// Pass 4: expands the spawn groups. Request j finds its group by binary search over the CPU-computed
// request prefixes, takes free unit slot j, and gets its position from the stateless RNG on the group's
// ring. Requests beyond the free count are rejected in order. Twin: kernels/unit-spawn.wgsl.
import { Fixed } from '../../core/fixed.js';
import { Rng } from '../../core/rng.js';
import { GROUP_WORDS, MISC, OH, TY, TYPE_WORDS, UNIT_ALIVE } from '../swarm-layout.js';

export class UnitSpawn {
  /** @param {import('./swarm-buffers.js').SwarmBuffers} b @param {import('./swarm-buffers.js').TickParams} p */
  static run(b, p) {
    const L = b.L;
    const free = b.A[L.aMisc + MISC.UNIT_FREE];
    const groups = p.inBase + L.inGroups;
    for (let j = 0; j < p.requests; j++) {
      if (j >= free) {
        b.O[OH.SPAWNS_REJECTED]++;
        continue;
      }
      let lo = 0;
      let hi = p.groups - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (b.I[groups + mid * GROUP_WORDS + 2] <= j) lo = mid;
        else hi = mid - 1;
      }
      const g = groups + lo * GROUP_WORDS;
      const w0 = b.I[g];
      const type = w0 & 0xff;
      const mode = (w0 >> 8) & 0xff;
      const r0 = b.I[g + 6];
      const r = r0 + Rng.below(Rng.u32(L.keySpawnR, p.tick, j), b.I[g + 7] - r0 + 1);
      const angle = Rng.u32(L.keySpawnA, p.tick, j) & 0xffff;
      const half = L.arenaHalf;
      const x = Fixed.clamp(b.I[g + 4] + Fixed.mulShr(r, Fixed.cosB(angle), 14), -half, half);
      const y = Fixed.clamp(b.I[g + 5] + Fixed.mulShr(r, Fixed.sinB(angle), 14), -half, half);
      const phase = Rng.u32(L.keyPhase, p.tick, j) & 0xff;
      const s = b.A[L.aUnitFree + j];
      b.Ui[L.uPosX + s] = x;
      b.Ui[L.uPosY + s] = y;
      b.U[L.uVel + s] = 0;
      b.U[L.uAltGen + s] = ((((b.U[L.uAltGen + s] >>> 16) + 1) & 0xffff) << 16) >>> 0;
      b.Ui[L.uHp + s] = Fixed.mulShr(b.T[L.tTypes + type * TYPE_WORDS + TY.MAX_HP], b.I[g + 3], 12);
      b.U[L.uInfo + s] = (type | UNIT_ALIVE | (mode << 16) | (phase << 24)) >>> 0;
      b.U[L.uSt0 + s] = 0;
      b.U[L.uSt1 + s] = 0;
    }
  }
}
