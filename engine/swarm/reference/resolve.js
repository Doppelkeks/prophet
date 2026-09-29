// @ts-check
// Pass 11: applies and clears each unit's accumulators. Deaths clear the alive flag and bump the kill
// counters per type and per credited source; survivors are counted. Twin: kernels/resolve.wgsl.
import { OH, UNIT_ALIVE } from '../swarm-layout.js';

export class Resolve {
  /** @param {import('./swarm-buffers.js').SwarmBuffers} b */
  static run(b) {
    const L = b.L;
    for (let i = 0; i < L.unitCap; i++) {
      const dmg = b.A[L.aDmg + i];
      const credit = b.A[L.aKiller + i];
      b.A[L.aDmg + i] = 0;
      b.A[L.aKiller + i] = 0;
      b.A[L.aImpX + i] = 0;
      b.A[L.aImpY + i] = 0;
      b.A[L.aStApply + i] = 0;
      const info = b.U[L.uInfo + i];
      if ((info & UNIT_ALIVE) === 0) continue;
      const hp = (b.Ui[L.uHp + i] - dmg) | 0;
      b.Ui[L.uHp + i] = hp;
      if (hp > 0) {
        b.O[OH.UNITS_ALIVE]++;
        continue;
      }
      b.U[L.uInfo + i] = (info & ~UNIT_ALIVE) >>> 0;
      b.O[OH.KILLS]++;
      const type = info & 0xff;
      if (type < L.typeCap) b.O[L.oKillsType + type]++;
      const source = credit & 0xffff;
      if (credit > 0 && source < L.sourceCap) b.O[L.oKillsSource + source]++;
    }
  }
}
