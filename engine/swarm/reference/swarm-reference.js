// @ts-check
// The pure-JS swarm (docs/engine/05-gpu-swarm.md#reference-implementation): the same passes, integer
// operations and packed buffers as the WGSL kernels, run on the CPU. Tests hold the GPU to it bit for bit.
// As a SwarmBackend it can hold outbound blocks back for a while, to prove that readback timing never
// changes results.
import { Hash32 } from '../../core/hash32.js';
import { Rng } from '../../core/rng.js';
import { IH, MISC } from '../swarm-layout.js';
import { SwarmKeys } from '../swarm-contract.js';
import { BinCount } from './bin-count.js';
import { BinScan } from './bin-scan.js';
import { BinScatter } from './bin-scatter.js';
import { ClearPass } from './clear-pass.js';
import { Contact } from './contact.js';
import { Finalize } from './finalize.js';
import { FreeScan } from './free-scan.js';
import { Integrate } from './integrate.js';
import { PickupSpawn } from './pickup-spawn.js';
import { Pickups } from './pickups.js';
import { Projectiles } from './projectiles.js';
import { Resolve } from './resolve.js';
import { ShotSpawn } from './shot-spawn.js';
import { Steer } from './steer.js';
import { SwarmBuffers } from './swarm-buffers.js';
import { Targeting } from './targeting.js';
import { UnitSpawn } from './unit-spawn.js';

/** The pass chain, in order. */
export const PASSES = /** @type {const} */ ([
  'clear', 'freeScan', 'shotSpawn', 'pickupSpawn', 'unitSpawn', 'binCount', 'binScan', 'binScatter',
  'steer', 'integrate', 'projectiles', 'resolve', 'contact', 'targeting', 'pickups', 'finalize',
]);

/** A small xorshift for shuffle mode (test-only randomness, never part of the simulation). */
class Shuffle {
  /** @param {number} seed */
  constructor(seed) {
    this.s = seed >>> 0 || 1;
  }
  next() {
    let x = this.s;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.s = x >>> 0;
    return this.s;
  }
}

export class SwarmReference {
  /**
   * @param {import('../swarm-layout.js').SwarmLayout} layout
   * @param {Int32Array} tables the T buffer (SwarmTables.build)
   * @param {{ seed: number, shuffle?: number, delay?: (tick: number) => number }} options
   *   `shuffle`: nonzero seeds a random order inside bins and among shots; `delay`: submissions after
   *   which a tick's outbound block arrives (0 = at once)
   */
  constructor(layout, tables, options) {
    this.layout = layout;
    this.keys = SwarmKeys.of(options.seed, Rng.key);
    this.b = new SwarmBuffers(layout, tables, this.keys);
    this.shuffle = options.shuffle ? new Shuffle(options.shuffle) : null;
    this.delay = options.delay ?? (() => 0);
    /** @type {{ tick: number, block: Int32Array, due: number }[]} */
    this.inFlight = [];
    /** @type {Map<number, Int32Array>} */
    this.arrived = new Map();
    this.clock = 0;
    this.lastDue = 0;
    /** @type {((pass: string, b: SwarmBuffers) => void) | null} hook after every pass (per-pass diffs) */
    this.afterPass = null;
  }

  /** @param {number} tick @param {Int32Array} inbound @param {number} prevFires */
  submit(tick, inbound, prevFires) {
    const b = this.b;
    const L = b.L;
    const inBase = (tick % this.layout.caps.ticksInFlight) * L.inWords;
    b.I.set(inbound.subarray(0, L.inWords), inBase);
    /** @type {import('./swarm-buffers.js').TickParams} */
    const p = {
      tick,
      inBase,
      prevFires,
      groups: inbound[IH.GROUPS],
      fires: inbound[IH.FIRES],
      proxies: inbound[IH.PROXIES],
      requests: inbound[IH.REQUESTS],
      flags: inbound[IH.FLAGS],
    };
    this.runTick(p);
    this.clock++;
    const due = Math.max(this.lastDue, this.clock + this.delay(tick));
    this.lastDue = due;
    this.inFlight.push({ tick, block: b.O.slice(), due });
    this.#deliver();
  }

  /** Runs the pass chain for one tick. @param {import('./swarm-buffers.js').TickParams} p */
  runTick(p) {
    const b = this.b;
    const after = this.afterPass;
    ClearPass.run(b, p);
    after?.('clear', b);
    FreeScan.run(b);
    after?.('freeScan', b);
    ShotSpawn.run(b, p);
    after?.('shotSpawn', b);
    PickupSpawn.run(b, p);
    after?.('pickupSpawn', b);
    UnitSpawn.run(b, p);
    after?.('unitSpawn', b);
    BinCount.run(b);
    after?.('binCount', b);
    BinScan.run(b);
    after?.('binScan', b);
    BinScatter.run(b, this.shuffle);
    after?.('binScatter', b);
    Steer.run(b, p);
    after?.('steer', b);
    Integrate.run(b);
    after?.('integrate', b);
    Projectiles.run(b, this.shuffle);
    after?.('projectiles', b);
    Resolve.run(b, p);
    after?.('resolve', b);
    Contact.run(b, p);
    after?.('contact', b);
    Targeting.run(b, p);
    after?.('targeting', b);
    Pickups.run(b, p);
    after?.('pickups', b);
    Finalize.run(b, p);
    after?.('finalize', b);
  }

  /** Lets simulated time pass: delayed blocks become available. */
  pump() {
    this.clock++;
    this.#deliver();
  }

  #deliver() {
    while (this.inFlight.length && this.inFlight[0].due <= this.clock) {
      const f = /** @type {{ tick: number, block: Int32Array }} */ (this.inFlight.shift());
      this.arrived.set(f.tick, f.block);
    }
  }

  /** @param {number} tick */
  take(tick) {
    const block = this.arrived.get(tick);
    if (!block) return null;
    this.arrived.delete(tick);
    return block;
  }

  /**
   * Canonical swarm state hash: the persistent pools by slot (units, shots, pickups), the pending shot
   * requests and drops, and the scrap carry. Bins and accumulator scratch are excluded
   * (docs/engine/05-gpu-swarm.md#reference-implementation).
   */
  hash() {
    const b = this.b;
    const L = b.L;
    let h = Hash32.words(b.U, 0, b.U.length);
    h = Hash32.words(b.P, 0, b.P.length, h);
    h = Hash32.words(b.A, L.aReq, L.fireCap * 8, h);
    h = Hash32.words(b.A, L.aDrop, L.unitCap, h);
    return Hash32.words(b.A, L.aMisc + MISC.SCRAP_CARRY, 1, h);
  }
}
