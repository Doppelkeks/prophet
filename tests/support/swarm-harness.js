// @ts-check
// Helpers for swarm tests: a reference swarm with a small layout, direct placement of units and shots
// for precise scenes, and a tick driver that tracks the previous tick's fire count.
import { Status, SwarmInbound, SwarmOutbound, SwarmTables, UnitFlag } from '../../engine/swarm/swarm-contract.js';
import { NO_HIT, PICK_ALIVE, SHOT_ALIVE, SwarmLayout, UNIT_ALIVE } from '../../engine/swarm/swarm-layout.js';
import { SwarmReference } from '../../engine/swarm/reference/swarm-reference.js';
import { SwarmMath } from '../../engine/swarm/reference/swarm-math.js';

/**
 * Test unit types: 0 grunt, 1 runner (immune to Stun), 2 brute (reports its death, resists knockback).
 * Q10 m per tick, Q10 m, Q8 HP; drop chance Q16.
 */
export const TEST_TYPES = [
  { speed: 55, radius: 358, maxHp: 768, contact: 256, interval: 10, dropChance: 32768, dropValue: 1 },
  { speed: 82, radius: 256, maxHp: 256, contact: 128, interval: 20, immune: 1 << Status.STUNNED },
  { speed: 34, radius: 614, maxHp: 3072, contact: 768, interval: 45, dropChance: 65536, dropValue: 5, flags: UnitFlag.REPORT, knockback: 192 },
];

/** Test status table: durations per tier in steps of 4 ticks, damage per step (Q8). */
export const TEST_STATUSES = /** @type {import('../../engine/swarm/swarm-contract.js').StatusSpec[]} */ ([
  { durations: [2, 4, 6], damage: 64 }, // burning
  { durations: [2, 3, 4], damage: 32 }, // shocked
  { durations: [4, 8, 12] }, // slowed
  { durations: [3, 5, 8] }, // stunned
  { durations: [4, 8, 12] }, // marked
  { durations: [2, 4, 6], damage: 16 }, // corroded
  { durations: [2, 2, 2] }, // magnetized
  { durations: [2, 2, 2] }, // overheated
]);

export class SwarmHarness {
  /**
   * @param {Partial<import('../../engine/swarm/swarm-layout.js').SwarmCaps>} [caps]
   * @param {{ seed?: number, shuffle?: number, delay?: (tick: number) => number, types?: import('../../engine/swarm/swarm-contract.js').UnitType[],
   *   statuses?: import('../../engine/swarm/swarm-contract.js').StatusSpec[] }} [o]
   */
  constructor(caps = {}, o = {}) {
    this.layout = new SwarmLayout({ units: 256, shots: 64, pickups: 64, groups: 8, fires: 32, proxies: 4, gridW: 32, arenaHalf: 32 * 1024, ...caps });
    this.tables = SwarmTables.build(this.layout, o.types ?? TEST_TYPES, o.statuses ?? TEST_STATUSES);
    this.ref = new SwarmReference(this.layout, this.tables, { seed: o.seed ?? 1234, shuffle: o.shuffle, delay: o.delay });
    this.inbound = new SwarmInbound(this.layout);
    this.tick = 0;
    this.prevFires = 0;
  }

  get L() {
    return this.ref.b.L;
  }

  /**
   * Runs one tick; `build` adds this tick's inbound records. Returns the tick's outbound report.
   * @param {(inbound: SwarmInbound) => void} [build]
   */
  step(build) {
    this.inbound.reset();
    build?.(this.inbound);
    this.ref.submit(this.tick, this.inbound.finish(this.tick), this.prevFires);
    this.prevFires = this.inbound.fires;
    const block = this.ref.take(this.tick);
    this.tick++;
    return block ? new SwarmOutbound(this.layout, block) : null;
  }

  /** Places a live unit directly in slot `s`. @param {number} s @param {number} x @param {number} y @param {number} [type] @param {number} [hp] @param {number} [phase] */
  unit(s, x, y, type = 0, hp = 10000, phase = 0) {
    const b = this.ref.b;
    const L = b.L;
    b.Ui[L.uPosX + s] = x;
    b.Ui[L.uPosY + s] = y;
    b.U[L.uVel + s] = 0;
    b.Ui[L.uHp + s] = hp;
    b.U[L.uInfo + s] = (type | UNIT_ALIVE | (phase << 24)) >>> 0;
  }

  /** Places a live shot directly in slot `s`. */
  shot(/** @type {number} */ s, /** @type {{ x: number, y: number, vx: number, vy: number, dmg: number, life: number, pierce?: number, source?: number }} */ o) {
    const b = this.ref.b;
    const L = b.L;
    b.Pi[L.pPosX + s] = o.x;
    b.Pi[L.pPosY + s] = o.y;
    b.P[L.pVel + s] = SwarmMath.packVel(o.vx, o.vy);
    b.Pi[L.pDmg + s] = o.dmg;
    b.P[L.pInfo + s] = (o.life | ((o.pierce ?? 0) << 16) | SHOT_ALIVE) >>> 0;
    b.P[L.pLastHit + s] = NO_HIT;
    b.P[L.pSource + s] = o.source ?? 0;
  }

  /** @param {number} s */
  pos(s) {
    const b = this.ref.b;
    return [b.Ui[b.L.uPosX + s], b.Ui[b.L.uPosY + s]];
  }

  /** @param {number} s */
  hp(s) {
    return this.ref.b.Ui[this.ref.b.L.uHp + s];
  }

  /** @param {number} s */
  alive(s) {
    return (this.ref.b.U[this.ref.b.L.uInfo + s] & UNIT_ALIVE) !== 0;
  }

  /** Status timer (steps left) of unit `s`. @param {number} s @param {number} status */
  timer(s, status) {
    const b = this.ref.b;
    const w = b.U[(status < 4 ? b.L.uSt0 : b.L.uSt1) + s];
    return (w >>> ((status & 3) << 3)) & 0xff;
  }

  /** @param {number} s */
  vel(s) {
    const v = this.ref.b.U[this.ref.b.L.uVel + s];
    return [SwarmMath.lo16(v), SwarmMath.hi16(v)];
  }

  /** @param {number} s */
  gen(s) {
    return this.ref.b.U[this.ref.b.L.uAltGen + s] >>> 16;
  }

  /** @param {number} s */
  shotAlive(s) {
    return (this.ref.b.P[this.ref.b.L.pInfo + s] & SHOT_ALIVE) !== 0;
  }

  /** Live pickups as [slot, x, y, value]. */
  pickups() {
    const b = this.ref.b;
    const L = b.L;
    /** @type {[number, number, number, number][]} */
    const out = [];
    for (let s = 0; s < L.pickCap; s++) if (b.P[L.kInfo + s] & PICK_ALIVE) out.push([s, b.Pi[L.kPosX + s], b.Pi[L.kPosY + s], b.Pi[L.kValue + s]]);
    return out;
  }

  /** Scrap dropped this tick that becomes pickups next tick. */
  pendingDrops() {
    const b = this.ref.b;
    let v = 0;
    for (let s = 0; s < b.L.unitCap; s++) v += b.A[b.L.aDrop + s];
    return v;
  }

  /** Kills unit `s` in this tick's resolve (its damage accumulator). @param {number} s */
  doom(s) {
    this.ref.b.A[this.ref.b.L.aDmg + s] = 0x3fffffff;
  }

  /** Live units. */
  count() {
    let n = 0;
    for (let s = 0; s < this.layout.caps.units; s++) if (this.alive(s)) n++;
    return n;
  }
}
