// @ts-check
// The CPU ↔ GPU swarm contract (docs/engine/05-gpu-swarm.md#cpu-gpu-contract): the inbound block the CPU
// writes every tick, the outbound block it reads back at T + K, and the type table. "The CPU decides
// when and what; the GPU decides who and where."
import { SIN_TABLE_Q14, SIN_TABLE_SIZE } from '../core/sin-table.js';
import {
  EFFECT_WORDS, EVENT_WORDS, FIRE_WORDS, GROUP_WORDS, HEADER_WORDS, IH, OH, OUT_MAGIC, PROXY_WORDS, STATUS_COUNT, STATUS_WORDS, TY, TYPE_WORDS,
} from './swarm-layout.js';

/** Target modes. v0: every mode chases proxy 0. */
export const Mode = Object.freeze({ CHASE: 0, ASSAULT: 1, SEEK: 2, SCATTER: 3 });
/** Spawn shapes. v0: ring. */
export const Shape = Object.freeze({ RING: 0 });
/** Targeting policies. v0: nearest. */
export const Policy = Object.freeze({ NEAREST: 0 });
/** Proxy teams and flags. */
export const Team = Object.freeze({ PLAYER: 0, ENEMY: 1 });
export const ProxyFlag = Object.freeze({ TARGETABLE: 1, BLOCKS: 2, COLLECTOR: 4, PUSHES: 8 });
/** Largest fire range: keeps squared distances inside i32 (16 m). */
export const MAX_RANGE = 16383;
/** Type-table behavior flags (TY.FLAGS bits 0-7; bits 8-15 are the status immunity mask). */
export const UnitFlag = Object.freeze({ REPORT: 1 });
/** The status vocabulary (docs/engine/05-gpu-swarm.md#status-effects): index = timer slot. */
export const Status = Object.freeze({ BURNING: 0, SHOCKED: 1, SLOWED: 2, STUNNED: 3, MARKED: 4, CORRODED: 5, MAGNETIZED: 6, OVERHEATED: 7 });
/** Area-effect shapes. M2: circle and ring. */
export const EffectShape = Object.freeze({ CIRCLE: 0, RING: 1 });
/** Event kinds and classes (one overflow bit per class). */
export const EventKind = Object.freeze({ UNIT_DIED: 1 });
export const EventClass = Object.freeze({ GAMEPLAY: 1, STATS: 2 });
/** Largest impulse an area effect may carry, and the most a unit's velocity takes in one tick (Q10 per tick). */
export const MAX_IMPULSE = 4096;

/**
 * @typedef {object} UnitType
 * @property {number} speed Q10 m per tick
 * @property {number} radius Q10 m
 * @property {number} maxHp Q8
 * @property {number} contact contact damage, Q8
 * @property {number} [armor] Q8
 * @property {number} interval attack cadence in ticks (1..255)
 * @property {number} [knockback] resistance (0..255)
 * @property {number} [flags]
 * @property {number} [dropChance] Q16 chance of dropping scrap on death (65536 = always)
 * @property {number} [dropValue] scrap units in the drop (0..32767)
 * @property {number} [immune] status immunity bitmask (1 << Status.X)
 */

/**
 * One status's tuning: timer steps per tier (1..3), and damage per step (Q8) while it runs.
 * @typedef {{ durations: [number, number, number], damage?: number }} StatusSpec
 */

export class SwarmTables {
  /**
   * The T buffer: the sine table, the type table, then the status table.
   * @param {import('./swarm-layout.js').SwarmLayout} layout
   * @param {UnitType[]} types
   * @param {StatusSpec[]} [statuses] by Status index; missing statuses last 0 steps and deal no damage
   */
  static build(layout, types, statuses = []) {
    if (types.length > layout.caps.types) throw new Error('swarm: more unit types than the type table holds');
    const t = new Int32Array(layout.words.T);
    t.set(SIN_TABLE_Q14, layout.L.tSin);
    for (let k = 0; k < types.length; k++) {
      const u = types[k];
      if (!(u.interval >= 1 && u.interval <= 255)) throw new Error(`swarm type ${k}: attack interval must be 1..255 ticks`);
      if (u.speed < 0 || u.speed > 1023 || u.radius <= 0 || u.radius > 1023) throw new Error(`swarm type ${k}: speed and radius must be below 1 m`);
      const at = layout.L.tTypes + k * TYPE_WORDS;
      t[at + TY.SPEED] = u.speed;
      t[at + TY.RADIUS] = u.radius;
      t[at + TY.MAX_HP] = u.maxHp;
      t[at + TY.CONTACT] = u.contact;
      t[at + TY.ARMOR] = u.armor ?? 0;
      t[at + TY.TIMING] = u.interval | ((u.knockback ?? 0) << 8);
      const immune = u.immune ?? 0;
      if ((u.flags ?? 0) & ~0xff || immune & ~0xff) throw new Error(`swarm type ${k}: flags and immunities are 8-bit masks`);
      t[at + TY.FLAGS] = (u.flags ?? 0) | (immune << 8);
      const chance = u.dropChance ?? 0;
      const value = u.dropValue ?? 0;
      if (!(chance >= 0 && chance <= 65536 && value >= 0 && value <= 32767)) throw new Error(`swarm type ${k}: drop chance must be 0..65536 (Q16) and drop value 0..32767`);
      t[at + TY.DROP] = chance | (value << 17); // chance in 17 bits (65536 = always), value above
    }
    if (statuses.length > STATUS_COUNT) throw new Error(`swarm: at most ${STATUS_COUNT} statuses`);
    for (let s = 0; s < statuses.length; s++) {
      const st = statuses[s];
      if (!st) continue;
      const [d1, d2, d3] = st.durations;
      for (const d of [d1, d2, d3]) if (!(d >= 0 && d <= 255)) throw new Error(`swarm status ${s}: durations are 0..255 steps`);
      const at = layout.L.tStatus + s * STATUS_WORDS;
      t[at] = d1 | (d2 << 8) | (d3 << 16);
      t[at + 1] = st.damage ?? 0;
    }
    return t;
  }

  static get sinSize() {
    return SIN_TABLE_SIZE;
  }
}

/** Builds one tick's inbound block. Engine thread; systems add records in a deterministic order. */
export class SwarmInbound {
  /** @param {import('./swarm-layout.js').SwarmLayout} layout */
  constructor(layout) {
    this.layout = layout;
    this.block = new Int32Array(layout.L.inWords);
    this.groups = 0;
    this.fires = 0;
    this.proxies = 0;
    this.effects = 0;
    this.requests = 0;
    this.flags = 0;
    /** Scrap value the CPU puts back on the ground this tick (after a swarm reset). */
    this.scrapIn = 0;
    /** Records beyond a cap, dropped in submission order (reported as not fired / rejected). */
    this.dropped = 0;
  }

  /** Starts a new tick. */
  reset() {
    this.block.fill(0);
    this.groups = this.fires = this.proxies = this.effects = this.requests = this.flags = this.scrapIn = this.dropped = 0;
  }

  /**
   * A ring of `count` units around (cx, cy), radius r0..r1 (Q10).
   * @param {{ type: number, mode?: number, count: number, hpScale?: number, cx: number, cy: number, r0: number, r1: number }} g
   * @returns {number} group index, or -1 when the group cap is reached
   */
  spawnRing(g) {
    const L = this.layout.L;
    if (this.groups >= L.groupCap || g.count <= 0) {
      this.dropped++;
      return -1;
    }
    if (g.r1 < g.r0 || g.r1 > 131071 || g.r0 < 0) throw new Error('swarm: spawn ring radii must satisfy 0 <= r0 <= r1 < 128 m');
    const at = L.inGroups + this.groups * GROUP_WORDS;
    const b = this.block;
    b[at] = (g.type & 0xff) | ((g.mode ?? Mode.CHASE) << 8) | (Shape.RING << 16);
    b[at + 1] = g.count;
    b[at + 2] = this.requests;
    b[at + 3] = g.hpScale ?? 4096;
    b[at + 4] = g.cx;
    b[at + 5] = g.cy;
    b[at + 6] = g.r0;
    b[at + 7] = g.r1;
    this.requests += g.count;
    return this.groups++;
  }

  /**
   * A fire command: the GPU picks the target (v0: nearest in range) and spawns one shot next tick.
   * @param {{ source: number, x: number, y: number, range: number, damage: number, speed: number, life: number, pierce?: number, policy?: number }} f
   * @returns {number} command index, or -1 when the cap is reached
   */
  fire(f) {
    const L = this.layout.L;
    if (this.fires >= L.fireCap) {
      this.dropped++;
      return -1;
    }
    if (f.range <= 0 || f.range > MAX_RANGE) throw new Error('swarm: fire range must be 1..16 m');
    if (f.speed < 0 || f.speed > 0xffff || f.life <= 0 || f.life > 0xffff || f.speed * f.life >= 1 << 24) {
      throw new Error('swarm: shot speed × lifetime must stay below 16,384 m');
    }
    const at = L.inFires + this.fires * FIRE_WORDS;
    const b = this.block;
    b[at] = (f.source & 0xffff) | ((f.policy ?? 0) << 16);
    b[at + 1] = (f.pierce ?? 0) << 16;
    b[at + 2] = f.range;
    b[at + 3] = f.damage;
    b[at + 4] = f.x;
    b[at + 5] = f.y;
    b[at + 6] = (f.speed & 0xffff) | (f.life << 16);
    b[at + 7] = 0;
    return this.fires++;
  }

  /**
   * An actor proxy. Proxy 0 is the one swarm units chase in v0. `aux` is the magnet radius (Q10) of a
   * collector: pickups inside it fly to the proxy, and are collected on touching it.
   * @param {{ entity: number, x: number, y: number, radius: number, team: number, kind?: number, flags?: number, hp?: number, aux?: number }} p
   * @returns {number} proxy index, or -1 when the cap is reached
   */
  proxy(p) {
    const L = this.layout.L;
    if (this.proxies >= L.proxyCap) {
      this.dropped++;
      return -1;
    }
    const aux = p.aux ?? 0;
    if (aux < 0 || aux > MAX_RANGE) throw new Error('swarm: a proxy magnet radius must be 0..16 m');
    const at = L.inProxies + this.proxies * PROXY_WORDS;
    const b = this.block;
    b[at] = p.entity;
    b[at + 1] = p.x;
    b[at + 2] = p.y;
    b[at + 3] = p.radius;
    b[at + 4] = (p.team & 0xff) | ((p.kind ?? 0) << 8) | ((p.flags ?? 0) << 16);
    b[at + 5] = p.hp ?? 0;
    b[at + 6] = aux;
    b[at + 7] = 0;
    return this.proxies++;
  }

  /**
   * Puts scrap back on the ground: the value joins the swarm's scrap carry and comes back as one merged
   * gem near proxy 0 (the economy's refund after a swarm reset).
   * @param {number} value scrap units
   */
  depositScrap(value) {
    if (!(value >= 0 && value <= 0x3fffffff)) throw new Error('swarm: scrap deposit out of range');
    this.scrapIn += value;
  }

  /**
   * An area effect: every enemy unit inside the shape takes the damage (with kill credit to `source`),
   * a radial impulse away from the center (Q10 per tick; negative pulls in), and the status at `tier`.
   * @param {{ shape?: number, team?: number, x: number, y: number, radius: number, inner?: number, damage?: number, impulse?: number,
   *   status?: number, tier?: number, source?: number }} e
   * @returns {number} effect index, or -1 when the cap is reached
   */
  effect(e) {
    const L = this.layout.L;
    if (this.effects >= L.effectCap) {
      this.dropped++;
      return -1;
    }
    const tier = e.tier ?? 0;
    const inner = e.inner ?? 0;
    const impulse = e.impulse ?? 0;
    if (e.radius <= 0 || e.radius > MAX_RANGE || inner < 0 || inner > e.radius) throw new Error('swarm: effect radii must satisfy 0 <= inner <= radius <= 16 m');
    if (tier < 0 || tier > 3 || (tier > 0 && !((e.status ?? -1) >= 0 && (e.status ?? 8) < STATUS_COUNT))) throw new Error('swarm: effect status tier must be 0..3 with a status');
    if (impulse < -MAX_IMPULSE || impulse > MAX_IMPULSE) throw new Error('swarm: effect impulse out of range');
    const at = L.inEffects + this.effects * EFFECT_WORDS;
    const b = this.block;
    b[at] = ((e.shape ?? EffectShape.CIRCLE) & 0xff) | (((e.team ?? Team.PLAYER) & 0xff) << 8) | (((e.status ?? 0) & 0xff) << 16) | (tier << 24);
    b[at + 1] = e.x;
    b[at + 2] = e.y;
    b[at + 3] = e.radius;
    b[at + 4] = inner;
    b[at + 5] = e.damage ?? 0;
    b[at + 6] = impulse;
    b[at + 7] = (e.source ?? 0) & 0xffff;
    return this.effects++;
  }

  /** Requests a swarm reset this tick (device loss). */
  requestReset() {
    this.flags |= 1;
  }

  /** Writes the header and returns the block. @param {number} tick */
  finish(tick) {
    const b = this.block;
    b[IH.TICK] = tick;
    b[IH.GROUPS] = this.groups;
    b[IH.FIRES] = this.fires;
    b[IH.PROXIES] = this.proxies;
    b[IH.REQUESTS] = this.requests;
    b[IH.FLAGS] = this.flags;
    b[IH.SCRAP_IN] = this.scrapIn;
    b[IH.EFFECTS] = this.effects;
    return b;
  }
}

/** Reads an outbound block (the GPU's report of one tick). */
export class SwarmOutbound {
  /** @param {import('./swarm-layout.js').SwarmLayout} layout @param {Int32Array} block */
  constructor(layout, block) {
    this.layout = layout;
    this.block = block;
    if (block[OH.MAGIC] !== OUT_MAGIC) throw new Error('swarm: outbound block without its magic word');
  }

  get tick() {
    return this.block[OH.TICK];
  }
  get unitsAlive() {
    return this.block[OH.UNITS_ALIVE];
  }
  get shotsAlive() {
    return this.block[OH.SHOTS_ALIVE];
  }
  get spawnsRejected() {
    return this.block[OH.SPAWNS_REJECTED];
  }
  get shotsRejected() {
    return this.block[OH.SHOTS_REJECTED];
  }
  get kills() {
    return this.block[OH.KILLS];
  }
  get fired() {
    return this.block[OH.FIRED];
  }
  get contactHits() {
    return this.block[OH.CONTACT_HITS];
  }
  /** Scrap value dropped by this tick's deaths. */
  get scrapDropped() {
    return this.block[OH.SCRAP_DROPPED];
  }
  /** Scrap value collected by every collector this tick. */
  get scrapCollected() {
    return this.block[OH.SCRAP_COLLECTED];
  }
  get pickupsAlive() {
    return this.block[OH.PICKUPS_ALIVE];
  }
  /** Scrap value waiting for a free pickup slot (drops that found none, deposits). */
  get scrapCarry() {
    return this.block[OH.SCRAP_CARRY];
  }

  /** @param {number} type */
  killsOfType(type) {
    return this.block[this.layout.L.oKillsType + type];
  }

  /** @param {number} source */
  killsOfSource(source) {
    return this.block[this.layout.L.oKillsSource + source];
  }

  /** Damage (Q8) dealt to proxy `p` this tick. @param {number} p */
  proxyDamage(p) {
    return this.block[this.layout.L.oProxyDmg + p];
  }

  /** Events in the block (the rest overflowed: see eventOverflow). */
  get events() {
    return Math.min(this.block[OH.EVENTS], this.layout.L.eventCap);
  }
  /** Overflow bits, one per EventClass: set when events of that class were lost (the run is tainted). */
  get eventOverflow() {
    return this.block[OH.EVENT_OVERFLOW];
  }

  /**
   * Word `w` of event `k` (canonical order): 0 kind | class << 8 | aux << 16, 1 target, 2 source, 3 value.
   * @param {number} k @param {number} w
   */
  event(k, w) {
    return this.block[this.layout.L.oEvents + k * EVENT_WORDS + w];
  }

  /**
   * Sorts a block's events by their full record, so identical records are interchangeable and the block
   * no longer depends on which GPU thread won the event cursor (docs/engine/05-gpu-swarm.md#cpu-gpu-contract).
   * Both backends apply it before a block is taken. Allocation-free: an insertion sort over 4-word records.
   * @param {import('./swarm-layout.js').SwarmLayout} layout @param {Int32Array} block
   */
  static canonicalize(layout, block) {
    const L = layout.L;
    const n = Math.min(block[OH.EVENTS], L.eventCap);
    const base = L.oEvents;
    for (let i = 1; i < n; i++) {
      const a0 = block[base + i * EVENT_WORDS];
      const a1 = block[base + i * EVENT_WORDS + 1];
      const a2 = block[base + i * EVENT_WORDS + 2];
      const a3 = block[base + i * EVENT_WORDS + 3];
      let j = i - 1;
      while (j >= 0 && SwarmOutbound.#after(block, base + j * EVENT_WORDS, a0, a1, a2, a3)) {
        block.copyWithin(base + (j + 1) * EVENT_WORDS, base + j * EVENT_WORDS, base + (j + 1) * EVENT_WORDS);
        j--;
      }
      const at = base + (j + 1) * EVENT_WORDS;
      block[at] = a0;
      block[at + 1] = a1;
      block[at + 2] = a2;
      block[at + 3] = a3;
    }
    return block;
  }

  /** Whether the record at `at` sorts after (a0..a3), comparing words as unsigned. @param {Int32Array} b @param {number} at @param {number} a0 @param {number} a1 @param {number} a2 @param {number} a3 */
  static #after(b, at, a0, a1, a2, a3) {
    if (b[at] !== a0) return b[at] >>> 0 > a0 >>> 0;
    if (b[at + 1] !== a1) return b[at + 1] >>> 0 > a1 >>> 0;
    if (b[at + 2] !== a2) return b[at + 2] >>> 0 > a2 >>> 0;
    return b[at + 3] >>> 0 > a3 >>> 0;
  }

  /** Scrap value collected by proxy `p` this tick. @param {number} p */
  proxyScrap(p) {
    return this.block[this.layout.L.oProxyScrap + p];
  }

  /** Whether fire command `k` found a target. @param {number} k */
  fireResult(k) {
    return ((this.block[this.layout.L.oFireBits + (k >>> 5)] >>> (k & 31)) & 1) === 1;
  }

  /** Words of the header, for asserts. */
  static get headerWords() {
    return HEADER_WORDS;
  }
}

/** The run's RNG keys for the spawn and phase streams (see Rng streams in docs/engine/09). */
export class SwarmKeys {
  static SPAWN_ANGLE = 1;
  static SPAWN_RADIUS = 2;
  static PHASE = 3;
  static DROP = 4;

  /** @param {number} seed @param {(seed: number, stream: number) => number} key */
  static of(seed, key) {
    return {
      keySpawnA: key(seed, SwarmKeys.SPAWN_ANGLE),
      keySpawnR: key(seed, SwarmKeys.SPAWN_RADIUS),
      keyPhase: key(seed, SwarmKeys.PHASE),
      keyDrop: key(seed, SwarmKeys.DROP),
    };
  }
}

