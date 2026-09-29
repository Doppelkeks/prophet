// @ts-check
// The headless simulation core: the fixed-step tick loop around the ECS scheduler, fed only by the
// command log (docs/engine/09-determinism-coop.md#input-as-commands). No DOM, GPU or clock, so the same
// code runs in the engine worker and in Node (replays, tests). Integer-only (sim lint).
import { CommandLog } from '../input/command-log.js';
import { SwarmInbound, SwarmOutbound } from '../swarm/swarm-contract.js';

/**
 * @typedef {object} SimResources engine-thread services systems may use (serial systems only)
 * @property {{ w0: number, w1: number, ui: Uint32Array, uiAt: number, uiCount: number }} input the input
 *   record of the running tick, and its UI commands: `uiCount` records of `UI_WORDS` from `ui[uiAt]`
 * @property {number} tick the running tick
 * @property {SwarmInbound | null} swarm this tick's inbound swarm block (spawns, fire commands, proxies)
 * @property {SwarmOutbound | null} swarmOut the swarm's report of tick − K, applied this tick
 */

/**
 * @typedef {object} SwarmLink
 * @property {import('../swarm/swarm-backend.js').SwarmBackend} backend
 * @property {number} K GPU→CPU latency in ticks (docs/BUDGETS.md#simulation-constants)
 */

export class SimCore {
  /**
   * @param {{
   *   world: import('../ecs/world.js').World,
   *   scheduler: import('../ecs/scheduler.js').Scheduler,
   *   resources: Record<string, any>,
   *   log?: CommandLog,
   *   hashEvery?: number,
   *   swarm?: SwarmLink | null,
   * }} o
   */
  constructor(o) {
    this.world = o.world;
    this.scheduler = o.scheduler;
    this.resources = o.resources;
    this.log = o.log ?? new CommandLog();
    /** State-hash interval in ticks (0 = never). */
    this.hashEvery = o.hashEvery ?? 0;
    /** The next tick to run. */
    this.tick = 0;
    /** @type {number[]} flat [tick, hash] pairs */
    this.hashes = [];
    /** Ticks that could not run because the swarm block they needed had not arrived. */
    this.stalls = 0;
    this.swarm = o.swarm ?? null;
    this.prevFires = 0;
    this.resources.input = { w0: 0, w1: 0, ui: this.log.uiWords, uiAt: 0, uiCount: 0 };
    this.resources.tick = 0;
    this.resources.swarm = this.swarm ? new SwarmInbound(this.swarm.backend.layout) : null;
    this.resources.swarmOut = null;
  }

  /**
   * Stamps the input record of the next tick, with the UI commands that arrived since the last stamp
   * (live play). A replay preloads the log instead, and stamping a tick that already has a record
   * changes nothing.
   * @param {number} w0 @param {number} w1
   * @param {Uint32Array | null} [ui] UI command records (`UI_WORDS` each) @param {number} [uiCount]
   * @returns {boolean} whether the record (and so the UI commands) went into the log
   */
  stamp(w0, w1, ui = null, uiCount = 0) {
    if (this.log.has(this.tick)) return false;
    this.log.set(this.tick, w0, w1, ui, uiCount);
    return true;
  }

  /** Whether the next tick has its input (a replay ends when it doesn't). */
  get ready() {
    return this.log.has(this.tick);
  }

  /**
   * Runs one tick. With a swarm, tick T first applies the swarm's block of tick T − K; if that block
   * has not arrived, the tick stalls (returns false) and must be retried later. It is never skipped.
   * @returns {Promise<boolean>} whether the tick ran
   */
  async step() {
    const t = this.tick;
    if (!this.log.has(t)) throw new Error(`sim: no input record for tick ${t}`);
    const res = this.resources;
    const swarm = this.swarm;
    if (swarm) {
      if (t >= swarm.K) {
        const block = swarm.backend.take(t - swarm.K);
        if (!block) {
          this.stalls++;
          return false;
        }
        const out = new SwarmOutbound(swarm.backend.layout, block);
        if (out.tick !== t - swarm.K) throw new Error(`sim: swarm block of tick ${out.tick} arrived for tick ${t - swarm.K}`);
        res.swarmOut = out;
      } else {
        res.swarmOut = null;
      }
      /** @type {SwarmInbound} */ (res.swarm).reset();
    }
    const input = res.input;
    input.w0 = this.log.w0(t);
    input.w1 = this.log.w1(t);
    input.ui = this.log.uiWords; // the log may have grown
    input.uiAt = this.log.uiAt(t);
    input.uiCount = this.log.uiCount(t);
    res.tick = t;
    await this.scheduler.tick();
    if (swarm) {
      const inbound = /** @type {SwarmInbound} */ (res.swarm);
      swarm.backend.submit(t, inbound.finish(t), this.prevFires);
      this.prevFires = inbound.fires;
    }
    this.tick = t + 1;
    if (this.hashEvery > 0 && this.tick % this.hashEvery === 0) this.hashes.push(this.tick, this.world.hash());
    return true;
  }

  /**
   * Runs ticks until the log runs out (replays). `wait` is called whenever a tick stalls, to let the
   * swarm's blocks arrive.
   * @param {number} [max] @param {() => void | Promise<void>} [wait]
   */
  async replay(max = 0x7fffffff, wait) {
    let n = 0;
    while (this.ready && n < max) {
      if (await this.step()) n++;
      else if (wait) await wait();
      else throw new Error(`sim: tick ${this.tick} stalled and nothing can deliver the swarm block`);
    }
    return n;
  }
}
