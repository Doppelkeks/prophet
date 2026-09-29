// @ts-check
// The CPU ↔ GPU swarm contract (docs/engine/05-gpu-swarm.md#cpu-gpu-contract): the inbound block the CPU
// writes every tick, the outbound block it reads back at T + K, and the type table. "The CPU decides
// when and what; the GPU decides who and where."
import { SIN_TABLE_Q14, SIN_TABLE_SIZE } from '../core/sin-table.js';
import { FIRE_WORDS, GROUP_WORDS, HEADER_WORDS, IH, OH, OUT_MAGIC, PROXY_WORDS, TY, TYPE_WORDS } from './swarm-layout.js';

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
 */

export class SwarmTables {
  /**
   * The T buffer: the sine table, then the type table.
   * @param {import('./swarm-layout.js').SwarmLayout} layout
   * @param {UnitType[]} types
   */
  static build(layout, types) {
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
      t[at + TY.FLAGS] = u.flags ?? 0;
      t[at + TY.DROP] = 0;
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
    this.requests = 0;
    this.flags = 0;
    /** Records beyond a cap, dropped in submission order (reported as not fired / rejected). */
    this.dropped = 0;
  }

  /** Starts a new tick. */
  reset() {
    this.block.fill(0);
    this.groups = this.fires = this.proxies = this.requests = this.flags = this.dropped = 0;
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
   * An actor proxy. Proxy 0 is the one swarm units chase in v0.
   * @param {{ entity: number, x: number, y: number, radius: number, team: number, kind?: number, flags?: number, hp?: number }} p
   * @returns {number} proxy index, or -1 when the cap is reached
   */
  proxy(p) {
    const L = this.layout.L;
    if (this.proxies >= L.proxyCap) {
      this.dropped++;
      return -1;
    }
    const at = L.inProxies + this.proxies * PROXY_WORDS;
    const b = this.block;
    b[at] = p.entity;
    b[at + 1] = p.x;
    b[at + 2] = p.y;
    b[at + 3] = p.radius;
    b[at + 4] = (p.team & 0xff) | ((p.kind ?? 0) << 8) | ((p.flags ?? 0) << 16);
    b[at + 5] = p.hp ?? 0;
    return this.proxies++;
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

  /** @param {number} seed @param {(seed: number, stream: number) => number} key */
  static of(seed, key) {
    return { keySpawnA: key(seed, SwarmKeys.SPAWN_ANGLE), keySpawnR: key(seed, SwarmKeys.SPAWN_RADIUS), keyPhase: key(seed, SwarmKeys.PHASE) };
  }
}

