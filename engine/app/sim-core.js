// @ts-check
// The headless simulation core: the fixed-step tick loop around the ECS scheduler, fed only by the
// command log (docs/engine/09-determinism-coop.md#input-as-commands). No DOM, GPU or clock, so the same
// code runs in the engine worker and in Node (replays, tests). Integer-only (sim lint).
import { CommandLog } from '../input/command-log.js';

/**
 * @typedef {object} SimResources engine-thread services systems may use (serial systems only)
 * @property {{ w0: number, w1: number }} input the input record of the running tick
 * @property {number} tick the running tick
 */

export class SimCore {
  /**
   * @param {{
   *   world: import('../ecs/world.js').World,
   *   scheduler: import('../ecs/scheduler.js').Scheduler,
   *   resources: Record<string, any>,
   *   log?: CommandLog,
   *   hashEvery?: number,
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
    this.resources.input = { w0: 0, w1: 0 };
    this.resources.tick = 0;
  }

  /**
   * Stamps the input record of the next tick (live play). A replay preloads the log instead, and
   * stamping a tick that already has a record changes nothing.
   * @param {number} w0 @param {number} w1
   */
  stamp(w0, w1) {
    if (!this.log.has(this.tick)) this.log.set(this.tick, w0, w1);
  }

  /** Whether the next tick has its input (a replay ends when it doesn't). */
  get ready() {
    return this.log.has(this.tick);
  }

  /** Runs one tick. */
  async step() {
    const t = this.tick;
    if (!this.log.has(t)) throw new Error(`sim: no input record for tick ${t}`);
    const input = this.resources.input;
    input.w0 = this.log.w0(t);
    input.w1 = this.log.w1(t);
    this.resources.tick = t;
    await this.scheduler.tick();
    this.tick = t + 1;
    if (this.hashEvery > 0 && this.tick % this.hashEvery === 0) this.hashes.push(this.tick, this.world.hash());
  }

  /** Runs ticks until the log runs out (replays). @param {number} [max] */
  async replay(max = 0x7fffffff) {
    let n = 0;
    while (this.ready && n < max) {
      await this.step();
      n++;
    }
    return n;
  }
}
