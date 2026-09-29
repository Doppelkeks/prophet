// @ts-check
// Pass 11: applies and clears each unit's accumulators (docs/engine/05-gpu-swarm.md#status-effects).
// - Statuses: every STATUS_STEP ticks each running timer counts down one step and deals its status's
//   damage per step; then this tick's applications set timer = max(timer, the tier's duration), unless the
//   type is immune. Tiers arrive as OR-ed unary codes, so the highest tier wins in any order.
// - Marked units take 25 % more hit damage.
// - Impulses (knockback) add to the velocity, scaled by the type's knockback resistance (255 = anchored).
// - Deaths clear the alive flag, bump the kill counters per type and per credited source, may drop scrap
//   (rand(DROP, tick, slot) against the type's chance), and report types emit a UNIT_DIED event.
// Twin: kernels/resolve.wgsl.
import { Fixed } from '../../core/fixed.js';
import { Rng } from '../../core/rng.js';
import { EVENT_WORDS, OH, STATUS_STEP, STATUS_WORDS, TY, TYPE_WORDS, UNIT_ALIVE } from '../swarm-layout.js';
import { EventClass, EventKind, MAX_IMPULSE, UnitFlag } from '../swarm-contract.js';
import { SwarmMath } from './swarm-math.js';

export class Resolve {
  /** @param {import('./swarm-buffers.js').SwarmBuffers} b @param {import('./swarm-buffers.js').TickParams} p */
  static run(b, p) {
    const L = b.L;
    const step = (p.tick & (STATUS_STEP - 1)) === 0;
    for (let i = 0; i < L.unitCap; i++) {
      let dmg = b.A[L.aDmg + i];
      const credit = b.A[L.aKiller + i];
      const impX = b.A[L.aImpX + i];
      const impY = b.A[L.aImpY + i];
      const apply = b.A[L.aStApply + i];
      b.A[L.aDmg + i] = 0;
      b.A[L.aKiller + i] = 0;
      b.A[L.aImpX + i] = 0;
      b.A[L.aImpY + i] = 0;
      b.A[L.aStApply + i] = 0;
      const info = b.U[L.uInfo + i];
      if ((info & UNIT_ALIVE) === 0) continue;
      const type = info & 0xff;
      const row = L.tTypes + Math.imul(type, TYPE_WORDS);
      const flags = b.T[row + TY.FLAGS];
      const immune = (flags >>> 8) & 0xff;
      let st0 = b.U[L.uSt0 + i];
      let st1 = b.U[L.uSt1 + i];
      if ((st1 & 0xff) !== 0) dmg += dmg >> 2; // Marked (status 4, the low byte of st1)
      let extra = 0;
      for (let s = 0; s < 8; s++) {
        const sh = (s & 3) << 3;
        const word = s < 4 ? st0 : st1;
        let t = (word >>> sh) & 0xff;
        const entry = L.tStatus + Math.imul(s, STATUS_WORDS);
        if (step && t > 0) {
          t--;
          extra += b.T[entry + 1];
        }
        const code = (apply >>> Math.imul(s, 3)) & 7;
        if (code !== 0 && (immune & (1 << s)) === 0) {
          const tier = code & 4 ? 3 : code & 2 ? 2 : 1;
          const d = (b.T[entry] >>> ((tier - 1) << 3)) & 0xff;
          if (d > t) t = d;
        }
        const next = ((word & ~(0xff << sh)) | (t << sh)) >>> 0;
        if (s < 4) st0 = next;
        else st1 = next;
      }
      b.U[L.uSt0 + i] = st0;
      b.U[L.uSt1 + i] = st1;
      const kb = (b.T[row + TY.TIMING] >>> 8) & 0xff;
      if ((impX !== 0 || impY !== 0) && kb < 255) {
        const v = b.U[L.uVel + i];
        const ix = Fixed.clamp(impX, -MAX_IMPULSE, MAX_IMPULSE);
        const iy = Fixed.clamp(impY, -MAX_IMPULSE, MAX_IMPULSE);
        const vx = Fixed.clamp(SwarmMath.lo16(v) + (Math.imul(ix, 256 - kb) >> 8), -MAX_IMPULSE, MAX_IMPULSE);
        const vy = Fixed.clamp(SwarmMath.hi16(v) + (Math.imul(iy, 256 - kb) >> 8), -MAX_IMPULSE, MAX_IMPULSE);
        b.U[L.uVel + i] = SwarmMath.packVel(vx, vy);
      }
      const hp = (b.Ui[L.uHp + i] - dmg - extra) | 0;
      b.Ui[L.uHp + i] = hp;
      if (hp > 0) {
        b.O[OH.UNITS_ALIVE]++;
        continue;
      }
      b.U[L.uInfo + i] = (info & ~UNIT_ALIVE) >>> 0;
      b.O[OH.KILLS]++;
      if (type < L.typeCap) b.O[L.oKillsType + type]++;
      const source = credit & 0xffff;
      if (credit > 0 && source < L.sourceCap) b.O[L.oKillsSource + source]++;
      if (type >= L.typeCap) continue;
      if (flags & UnitFlag.REPORT) Resolve.event(b, i, type, credit > 0 ? source : 0xffff);
      const drop = b.T[row + TY.DROP];
      const value = drop >>> 17;
      if (value > 0 && Rng.chance(Rng.u32(L.keyDrop, p.tick, i), drop & 0x1ffff)) {
        b.A[L.aDrop + i] = value;
        b.O[OH.SCRAP_DROPPED] += value;
      }
    }
  }

  /**
   * Appends a UNIT_DIED event (gameplay class): unit type, slot and generation, credited source, and the
   * position in 1/16 m. Past the cap it sets the class's overflow bit instead.
   * @param {import('./swarm-buffers.js').SwarmBuffers} b @param {number} i @param {number} type @param {number} source
   */
  static event(b, i, type, source) {
    const L = b.L;
    const k = b.O[OH.EVENTS]++;
    if (k >= L.eventCap) {
      b.O[OH.EVENT_OVERFLOW] |= EventClass.GAMEPLAY;
      return;
    }
    const at = L.oEvents + k * EVENT_WORDS;
    b.O[at] = EventKind.UNIT_DIED | (EventClass.GAMEPLAY << 8) | (type << 16);
    b.O[at + 1] = (i & 0xffffff) | ((b.U[L.uAltGen + i] >>> 16) << 24);
    b.O[at + 2] = source;
    b.O[at + 3] = ((b.Ui[L.uPosX + i] >> 6) & 0xffff) | ((b.Ui[L.uPosY + i] >> 6) << 16);
  }
}
