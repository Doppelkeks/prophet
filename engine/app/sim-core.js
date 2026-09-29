// @ts-check
// The headless simulation core: the fixed-step tick loop around the ECS scheduler, fed only by the
// command log (docs/engine/09-determinism-coop.md#input-as-commands). No DOM, GPU or clock, so the same
// code runs in the engine worker and in Node (replays, tests). Integer-only (sim lint).
import { CommandLog, UI_MAX, UI_WORDS } from '../input/command-log.js';
import { SwarmInbound, SwarmOutbound } from '../swarm/swarm-contract.js';
import { OH, OUT_MAGIC } from '../swarm/swarm-layout.js';

/**
 * Engine commands share the UI command records of the log, with codes games never use (bit 31 set):
 * replays reproduce them on their tick (docs/engine/09-determinism-coop.md#input-as-commands).
 */
export const EngineCommand = Object.freeze({
  /** Empties the swarm on this tick and discards the blocks of the K ticks before it (device loss). */
  SWARM_RESET: 0x80000001,
});

/**
 * @typedef {object} SimResources engine-thread services systems may use (serial systems only)
 * @property {{ w0: number, w1: number, ui: Uint32Array, uiAt: number, uiCount: number }} input the input
 *   record of the running tick, and its UI commands: `uiCount` records of `UI_WORDS` from `ui[uiAt]`
 * @property {number} tick the running tick
 * @property {SwarmInbound | null} swarm this tick's inbound swarm block (spawns, fire commands, proxies)
 * @property {SwarmOutbound | null} swarmOut the swarm's report of tick − K, applied this tick
 * @property {boolean} swarmReset the swarm resets on this tick (after a device loss): its pools start empty
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
    this.resources.swarmReset = false;
    /** Swarm blocks of ticks in [emptyFrom, emptyUntil) were discarded by a swarm reset. */
    this.emptyFrom = 0;
    this.emptyUntil = 0;
    /** Swarm resets applied. */
    this.resets = 0;
    /** Swarm blocks that lost events (an overflow bit): detail differs between machines, so the run is tainted. */
    this.taints = 0;
    this.pendingReset = false;
    this.engineCmd = new Uint32Array(UI_WORDS);
    this.empty = new Int32Array(this.swarm ? this.swarm.backend.layout.L.outWords : 0);
    /** The view of the block applied this tick, reused every tick. */
    this.outView = this.swarm ? new SwarmOutbound(this.swarm.backend.layout, this.#emptyBlock(0)) : null;
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
    if (this.pendingReset) {
      this.log.set(this.tick, w0, w1, ui, uiCount < UI_MAX ? uiCount : UI_MAX - 1); // the reset takes the last slot
      this.log.amend(this.tick, this.engineCmd, 1);
      this.pendingReset = false;
    } else {
      this.log.set(this.tick, w0, w1, ui, uiCount);
    }
    return true;
  }

  /**
   * Logs a swarm reset for the next tick to run (docs/engine/05-gpu-swarm.md#resets-and-device-loss): the
   * engine calls it after a device loss, once the new swarm exists. If that tick is already stamped (it
   * stalled on a block the lost device never delivered), its record is amended, since it has not run.
   */
  requestSwarmReset() {
    if (!this.swarm) return;
    const cmd = this.engineCmd;
    cmd[0] = EngineCommand.SWARM_RESET;
    cmd[1] = 0;
    cmd[2] = 0;
    if (this.log.has(this.tick)) this.log.amend(this.tick, cmd, 1);
    else this.pendingReset = true;
  }

  /** A block with no events for tick `b` (a block a swarm reset discarded). @param {number} b */
  #emptyBlock(b) {
    const e = this.empty;
    e.fill(0);
    e[OH.MAGIC] = OUT_MAGIC;
    e[OH.TICK] = b;
    return e;
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
    return this.advance();
  }

  /**
   * `step` without the promise: true if the tick ran, false if it stalled, and a promise (of true) only
   * when a system had to wait for job workers. The engine's frame loop uses it, so a tick allocates
   * nothing on the way.
   * @returns {boolean | Promise<boolean>}
   */
  advance() {
    const t = this.tick;
    if (!this.log.has(t)) throw new Error(`sim: no input record for tick ${t}`);
    const res = this.resources;
    const swarm = this.swarm;
    if (swarm) {
      // A swarm reset on this tick discards the blocks of ticks t − K .. t − 1: the ticks from here to
      // t + K − 1 see empty blocks instead, whether or not those blocks arrived.
      const log = this.log;
      const at = log.uiAt(t);
      let reset = false;
      for (let i = log.uiCount(t) - 1; i >= 0; i--) if (log.uiWords[at + Math.imul(i, UI_WORDS)] === EngineCommand.SWARM_RESET) reset = true;
      if (reset) {
        this.emptyFrom = t - swarm.K;
        this.emptyUntil = t;
        this.resets++;
      }
      res.swarmReset = reset;
      if (t >= swarm.K) {
        const b = t - swarm.K;
        let block = null;
        if (b >= this.emptyFrom && b < this.emptyUntil) {
          swarm.backend.take(b); // dropped if it did arrive (a replay's reference swarm delivers everything)
          block = this.#emptyBlock(b);
        } else {
          block = swarm.backend.take(b);
          if (!block) {
            this.stalls++;
            return false;
          }
        }
        const out = /** @type {SwarmOutbound} */ (this.outView).attach(block);
        if (out.tick !== b) throw new Error(`sim: swarm block of tick ${out.tick} arrived for tick ${b}`);
        if (out.eventOverflow !== 0) this.taints++;
        res.swarmOut = out;
      } else {
        res.swarmOut = null;
      }
      const inbound = /** @type {SwarmInbound} */ (res.swarm);
      inbound.reset();
      if (reset) inbound.requestReset();
    }
    const input = res.input;
    input.w0 = this.log.w0(t);
    input.w1 = this.log.w1(t);
    input.ui = this.log.uiWords; // the log may have grown
    input.uiAt = this.log.uiAt(t);
    input.uiCount = this.log.uiCount(t);
    res.tick = t;
    const wait = this.scheduler.tick();
    if (wait) return wait.then(() => this.#endTick(t)); // only when a system ran on job workers
    return this.#endTick(t);
  }

  /** Submits tick `t`'s swarm block and moves to the next tick. @param {number} t @returns {true} */
  #endTick(t) {
    const swarm = this.swarm;
    if (swarm) {
      const inbound = /** @type {SwarmInbound} */ (this.resources.swarm);
      swarm.backend.submit(t, inbound.finish(t), this.prevFires, inbound.field);
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
