// @ts-check
// The swarm's packed buffer layout (docs/engine/05-gpu-swarm.md#data-layout), shared by the WGSL kernels
// and the JS reference. Every offset is in 32-bit words. The same numbers go into the `Layout` uniform
// that every kernel reads, so the two implementations can't drift apart.
//
// Buffers:
//   U  units, persistent SoA           posX posY vel altGen hp info st0 st1            (one word each)
//   P  shots, persistent SoA           posX posY vel dmg info meta lastHit source
//   A  scratch and atomics             per-unit accumulators, bins, free lists, scan scratch, shot requests
//   I  inbound ring                    `ticksInFlight` blocks: header, spawn groups, fire commands, proxies
//   O  outbound block                  header, kills per type and source, proxy damage, fire-result bits
//   T  tables                          sine table (Q14), type table

import { SIN_TABLE_SIZE } from '../core/sin-table.js';

/** Unit `info` word: u8 type | u8 flags << 8 | u8 target mode << 16 | u8 anim phase << 24. */
export const UNIT_ALIVE = 0x100;
/** Shot `info` word: u16 lifetime | u8 pierce left << 16 | u8 flags << 24. */
export const SHOT_ALIVE = 0x1000000;
/** Shot `lastHit` when it has hit nothing yet. */
export const NO_HIT = 0xffffffff;

/** Words per record. */
export const GROUP_WORDS = 8; // 32 B spawn group
export const FIRE_WORDS = 8; // 32 B fire command
export const PROXY_WORDS = 6; // 24 B actor proxy
export const TYPE_WORDS = 8; // type-table entry
export const REQ_WORDS = 8; // shot request, targeting (tick T) → shot spawn (tick T + 1)
export const HEADER_WORDS = 16;

/** Inbound header words. */
export const IH = Object.freeze({ TICK: 0, GROUPS: 1, FIRES: 2, PROXIES: 3, REQUESTS: 4, FLAGS: 5 });
/** Outbound header words. */
export const OH = Object.freeze({ MAGIC: 0, TICK: 1, FLAGS: 2, UNITS_ALIVE: 3, SHOTS_ALIVE: 4, SPAWNS_REJECTED: 5, SHOTS_REJECTED: 6, KILLS: 7, FIRED: 8, CONTACT_HITS: 9 });
export const OUT_MAGIC = 0x53574f42; // 'SWOB'
/** Type-table words. */
export const TY = Object.freeze({ SPEED: 0, RADIUS: 1, MAX_HP: 2, CONTACT: 3, ARMOR: 4, TIMING: 5, FLAGS: 6, DROP: 7 });
/** Scratch words in A (`misc`). */
export const MISC = Object.freeze({ UNIT_FREE: 0, SHOT_FREE: 1, WORDS: 16 });
/** Workgroup scan block (elements per block in the free-slot and bin scans). */
export const SCAN_BLOCK = 256;

/**
 * @typedef {object} SwarmCaps
 * @property {number} units unit pool
 * @property {number} shots projectile pool
 * @property {number} groups spawn groups per tick
 * @property {number} fires fire commands per tick
 * @property {number} proxies actor proxies per tick
 * @property {number} types type-table entries
 * @property {number} sources kill-credit sources
 * @property {number} gridW bins per side
 * @property {number} cellShift bin size as a power of two, Q10 (11 = 2 m)
 * @property {number} originX Q10 world position of bin (0, 0); default: the grid is centered on the origin
 * @property {number} originY
 * @property {number} arenaHalf Q10: units are clamped to ±arenaHalf
 * @property {number} pairCap separation is pairwise in cells with at most this many units
 * @property {number} ticksInFlight inbound blocks the ring holds (ticks encoded per frame)
 */

/** Layout uniform, in order. The WGSL `Layout` struct is generated from this list. */
export const LAYOUT_FIELDS = /** @type {const} */ ([
  'unitCap', 'shotCap', 'gridW', 'cellShift', 'originX', 'originY', 'arenaHalf', 'pairCap',
  'uPosX', 'uPosY', 'uVel', 'uAltGen', 'uHp', 'uInfo', 'uSt0', 'uSt1',
  'pPosX', 'pPosY', 'pVel', 'pDmg', 'pInfo', 'pMeta', 'pLastHit', 'pSource',
  'aDmg', 'aImpX', 'aImpY', 'aStApply', 'aKiller', 'aBinCount', 'aBinSumX', 'aBinSumY',
  'aBinStart', 'aBinCursor', 'aBinEntries', 'aUnitFree', 'aShotFree', 'aMisc', 'aScan', 'aReq',
  'inWords', 'inGroups', 'inFires', 'inProxies', 'groupCap', 'fireCap', 'proxyCap', 'cells',
  'outWords', 'oKillsType', 'oKillsSource', 'oProxyDmg', 'oFireBits', 'typeCap', 'sourceCap', 'scanBlocks',
  'tSin', 'tTypes', 'keySpawnA', 'keySpawnR', 'keyPhase', 'aScanTmp', 'pad1', 'pad2',
]);

export class SwarmLayout {
  /** @type {SwarmCaps} */
  static DEFAULTS = Object.freeze({
    units: 4096,
    shots: 2048,
    groups: 64,
    fires: 256,
    proxies: 16,
    types: 16,
    sources: 64,
    gridW: 128,
    cellShift: 11,
    originX: NaN,
    originY: NaN,
    arenaHalf: 65536,
    pairCap: 8,
    ticksInFlight: 4,
  });

  /** @param {Partial<SwarmCaps>} [caps] */
  constructor(caps = {}) {
    const c = { ...SwarmLayout.DEFAULTS, ...caps };
    const span = c.gridW << c.cellShift;
    if (Number.isNaN(c.originX)) c.originX = -(span >> 1);
    if (Number.isNaN(c.originY)) c.originY = -(span >> 1);
    if (c.originX > -c.arenaHalf || c.originY > -c.arenaHalf || c.originX + span < c.arenaHalf || c.originY + span < c.arenaHalf) {
      throw new Error('swarm: the bin grid must cover the whole arena');
    }
    this.caps = c;
    const scanElems = Math.max(c.units, c.shots, c.gridW * c.gridW);
    const scanBlocks = Math.ceil(scanElems / SCAN_BLOCK);
    if (scanBlocks > SCAN_BLOCK * 4) throw new Error('swarm: pools larger than the three-level scan supports');
    if (c.groups > 1024 || c.fires > 1024 || c.fires % 32 !== 0) throw new Error('swarm: fires must be a multiple of 32, at most 1024');
    if (c.units > 0xffffff || c.shots > 0xffffff) throw new Error('swarm: pools must fit 24 bits');
    const cells = c.gridW * c.gridW;

    /** @type {Record<string, number>} */
    const L = {};
    L.unitCap = c.units;
    L.shotCap = c.shots;
    L.gridW = c.gridW;
    L.cellShift = c.cellShift;
    L.originX = c.originX;
    L.originY = c.originY;
    L.arenaHalf = c.arenaHalf;
    L.pairCap = c.pairCap;
    let u = 0;
    for (const f of ['uPosX', 'uPosY', 'uVel', 'uAltGen', 'uHp', 'uInfo', 'uSt0', 'uSt1']) {
      L[f] = u;
      u += c.units;
    }
    let p = 0;
    for (const f of ['pPosX', 'pPosY', 'pVel', 'pDmg', 'pInfo', 'pMeta', 'pLastHit', 'pSource']) {
      L[f] = p;
      p += c.shots;
    }
    let a = 0;
    for (const f of ['aDmg', 'aImpX', 'aImpY', 'aStApply', 'aKiller']) {
      L[f] = a;
      a += c.units;
    }
    for (const f of ['aBinCount', 'aBinSumX', 'aBinSumY', 'aBinStart', 'aBinCursor']) {
      L[f] = a;
      a += cells;
    }
    L.aBinEntries = a;
    a += c.units;
    L.aUnitFree = a;
    a += c.units;
    L.aShotFree = a;
    a += c.shots;
    L.aMisc = a;
    a += MISC.WORDS;
    L.aScan = a; // per-block sums, scanned in place into block offsets
    a += SCAN_BLOCK * 4;
    L.aScanTmp = a; // per-element exclusive prefix inside its block
    a += scanElems;
    L.aReq = a;
    a += c.fires * REQ_WORDS;

    L.inGroups = HEADER_WORDS;
    L.inFires = L.inGroups + c.groups * GROUP_WORDS;
    L.inProxies = L.inFires + c.fires * FIRE_WORDS;
    L.inWords = L.inProxies + c.proxies * PROXY_WORDS;
    L.groupCap = c.groups;
    L.fireCap = c.fires;
    L.proxyCap = c.proxies;
    L.cells = cells;

    L.oKillsType = HEADER_WORDS;
    L.oKillsSource = L.oKillsType + c.types;
    L.oProxyDmg = L.oKillsSource + c.sources;
    L.oFireBits = L.oProxyDmg + c.proxies;
    L.outWords = L.oFireBits + (c.fires >>> 5);
    L.typeCap = c.types;
    L.sourceCap = c.sources;
    L.scanBlocks = scanBlocks;

    L.tSin = 0;
    L.tTypes = SIN_TABLE_SIZE;
    L.keySpawnA = 0;
    L.keySpawnR = 0;
    L.keyPhase = 0;
    L.pad1 = L.pad2 = 0;

    /** Word offsets and sizes by name. */
    this.L = L;
    /** Buffer sizes in words. */
    this.words = {
      U: u,
      P: p,
      A: a,
      I: L.inWords * c.ticksInFlight,
      O: L.outWords,
      T: SIN_TABLE_SIZE + c.types * TYPE_WORDS,
    };
  }

  /** The `Layout` uniform, with the run's RNG keys. @param {{ keySpawnA: number, keySpawnR: number, keyPhase: number }} keys */
  uniform(keys) {
    const out = new Uint32Array(LAYOUT_FIELDS.length);
    for (let i = 0; i < LAYOUT_FIELDS.length; i++) {
      const f = LAYOUT_FIELDS[i];
      out[i] = f === 'keySpawnA' ? keys.keySpawnA : f === 'keySpawnR' ? keys.keySpawnR : f === 'keyPhase' ? keys.keyPhase : this.L[f];
    }
    return out;
  }

  /** The WGSL declaration of the `Layout` struct (field order = LAYOUT_FIELDS). */
  static wgslStruct() {
    return `struct Layout {\n${LAYOUT_FIELDS.map((f) => `  ${f}: u32,`).join('\n')}\n}\n`;
  }

  /**
   * Every constant the kernels share with the JS side, as WGSL `const` declarations, so the two can't
   * drift apart. Prepended to every swarm kernel with the Layout struct.
   * @param {Record<string, number>} extra more u32 constants (pass constants of the reference)
   */
  static wgslConstants(extra = {}) {
    /** @type {[string, number][]} */
    const c = [
      ['UNIT_ALIVE', UNIT_ALIVE],
      ['SHOT_ALIVE', SHOT_ALIVE],
      ['NO_HIT', NO_HIT],
      ['GROUP_WORDS', GROUP_WORDS],
      ['FIRE_WORDS', FIRE_WORDS],
      ['PROXY_WORDS', PROXY_WORDS],
      ['TYPE_WORDS', TYPE_WORDS],
      ['REQ_WORDS', REQ_WORDS],
      ['SCAN_BLOCK', SCAN_BLOCK],
      ['OUT_MAGIC', OUT_MAGIC],
      ...Object.entries(IH).map(([k, v]) => /** @type {[string, number]} */ ([`IH_${k}`, v])),
      ...Object.entries(OH).map(([k, v]) => /** @type {[string, number]} */ ([`OH_${k}`, v])),
      ...Object.entries(TY).map(([k, v]) => /** @type {[string, number]} */ ([`TY_${k}`, v])),
      ...Object.entries(MISC).map(([k, v]) => /** @type {[string, number]} */ ([`MISC_${k}`, v])),
      ...Object.entries(extra),
    ];
    return c.map(([k, v]) => `const ${k}: u32 = ${v >>> 0}u;`).join('\n') + '\n';
  }
}
