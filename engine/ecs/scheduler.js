// @ts-check
// The scheduler (docs/engine/02-core-ecs-jobs.md#scheduler). Built once at boot from the systems'
// static declarations:
// 1. explicit `after` / `before` edges per stage (a cycle is a boot error naming the systems);
// 2. the serial order: Kahn's algorithm that always takes the ready system with the lowest system ID;
// 3. conflict edges between systems that write what the other reads or writes, in serial order.
//    Dev builds warn about conflicting pairs without an explicit order.
// Systems run one at a time in serial order. A system with a query runs chunk-parallel on the job
// system when allowed (`shared` tier), otherwise serially; both produce identical command segments.
// Between stages (sync points) the command buffers are applied.
// A tick is synchronous until a system has to wait for job workers: `tick`, `runStage` and `extract` return
// null when everything ran on this thread (nothing allocated), and a promise for the rest otherwise.
import { CommandApplier } from './command-buffer.js';
import { SystemChunkKernel } from './ecs-env.js';

/** @typedef {import('./system.js').Stage} Stage */
/** @typedef {import('./system.js').SystemClass} SystemClass */

export const STAGES = /** @type {const} */ (['Input', 'PreSim', 'Sim', 'PostSim', 'Extract']);
/** Stages that run once per sim tick; Extract runs once per rendered frame. */
export const TICK_STAGES = /** @type {const} */ (['Input', 'PreSim', 'Sim', 'PostSim']);
const PARALLEL = ['auto', 'serial', 'chunks'];

/**
 * @typedef {object} SchedulePlan
 * @property {Record<Stage, number[]>} order serial order of system IDs per stage
 * @property {[number, number, 'explicit' | 'conflict'][]} edges
 * @property {string[]} warnings
 */

/**
 * @typedef {object} SchedulerOptions
 * @property {import('./world.js').World} world
 * @property {import('./ecs-env.js').EcsEnv} env the engine thread's environment (participant 0)
 * @property {import('../jobs/job-system.js').JobSystem | null} [jobs] runs chunk-parallel systems (`shared` tier)
 * @property {'auto' | 'always' | 'never'} [parallel] `always` splits every system with a query (tests);
 *   `auto` splits only systems declared `parallel = 'chunks'` until per-tier profile tables exist
 * @property {number} [grain] chunks per claim
 */

export class Scheduler {
  /** @param {SchedulerOptions} o */
  constructor(o) {
    this.world = o.world;
    this.manifest = o.world.manifest;
    this.env = o.env;
    this.jobs = o.jobs ?? null;
    this.mode = o.parallel ?? 'auto';
    this.grain = o.grain ?? 1;
    this.plan = Scheduler.plan(this.manifest);
    if (DEV) for (const w of this.plan.warnings) console.warn(`[prophet] scheduler: ${w}`);
    const reg = this.manifest.components;
    const systems = this.manifest.systems;
    this.queries = systems.map((S) => (S.query ? o.world.query(S.query) : null));
    /** Field handles each system writes in place (their change ticks are bumped on every visit). */
    this.writeFields = systems.map((S) => S.writes.flatMap((K) => reg.fields[reg.id(K)].map((f) => f.handle)));
    /** Change clock of each system's previous run. */
    this.lastRun = new Int32Array(systems.length).fill(-1);
    this.applier = new CommandApplier(o.world);
    this.ticks = 0;
    this.stats = { serialChunks: 0, parallelChunks: 0, segments: 0 };
  }

  /**
   * Runs the per-tick stages with a sync point after each.
   * @returns {Promise<void> | null} null when the whole tick ran on this thread
   */
  tick() {
    for (let s = 0; s < TICK_STAGES.length; s++) {
      const wait = this.runStage(TICK_STAGES[s]);
      if (wait) return this.#tickFrom(wait, s + 1);
    }
    this.ticks++;
    return null;
  }

  /** The rest of a tick once a stage waits for job workers. @param {Promise<void>} wait @param {number} s next stage */
  async #tickFrom(wait, s) {
    await wait;
    for (; s < TICK_STAGES.length; s++) {
      const w = this.runStage(TICK_STAGES[s]);
      if (w) await w;
    }
    this.ticks++;
  }

  /**
   * Runs the Extract stage (once per rendered frame).
   * @returns {Promise<void> | null}
   */
  extract() {
    return this.runStage('Extract');
  }

  /**
   * Runs one stage's systems in serial order, then applies the command buffers.
   * @param {Stage} stage
   * @returns {Promise<void> | null} null when every system ran on this thread
   */
  runStage(stage) {
    const order = this.plan.order[stage];
    for (let i = 0; i < order.length; i++) {
      const wait = this.#runSystem(order[i]);
      if (wait) return this.#stageFrom(wait, order, i + 1);
    }
    this.stats.segments += this.applier.apply();
    return null;
  }

  /** The rest of a stage once a system waits for job workers. @param {Promise<void>} wait @param {number[]} order @param {number} i next system */
  async #stageFrom(wait, order, i) {
    await wait;
    for (; i < order.length; i++) {
      const w = this.#runSystem(order[i]);
      if (w) await w;
    }
    this.stats.segments += this.applier.apply();
  }

  /** @param {SystemClass} S */
  #parallel(S) {
    const jobs = this.jobs;
    if (!jobs || jobs.tier !== 'shared' || this.mode === 'never' || S.parallel === 'serial') return false;
    return S.parallel === 'chunks' || this.mode === 'always';
  }

  /** @param {number} id @returns {Promise<void> | null} a promise when the system runs on job workers */
  #runSystem(id) {
    const S = this.manifest.systems[id];
    const world = this.world;
    const clock = world.bumpClock();
    const query = this.queries[id];
    if (!query) {
      const cmd = this.env.writer;
      cmd.begin(id, 0);
      try {
        this.env.systems[id].update(cmd);
      } catch (err) {
        cmd.abort();
        throw err;
      }
      cmd.end();
    } else {
      const n = query.collect(this.lastRun[id], world.heap.i32, world.listW, world.listCap);
      world.stampChunks(world.listW, n, this.writeFields[id], clock);
      if (n > 0 && this.jobs && this.#parallel(S)) return this.#runParallel(id, n, clock);
      if (n > 0) {
        this.env.runChunks(id, world.listW, 0, n);
        this.stats.serialChunks += n;
      }
    }
    this.lastRun[id] = clock;
    return null;
  }

  /** Runs a system's `n` collected chunks on the job workers. @param {number} id @param {number} n @param {number} clock */
  async #runParallel(id, n, clock) {
    const jobs = /** @type {import('../jobs/job-system.js').JobSystem} */ (this.jobs);
    await jobs.wait(jobs.parallelFor(SystemChunkKernel, [id, this.world.listW << 2], 0, n, this.grain));
    this.stats.parallelChunks += n;
    this.lastRun[id] = clock;
  }

  /**
   * Validates the systems and builds the per-stage order.
   * @param {import('./registry.js').Manifest} manifest
   * @returns {SchedulePlan}
   */
  static plan(manifest) {
    const systems = manifest.systems;
    const reg = manifest.components;
    const n = systems.length;
    const stageOf = systems.map((S) => STAGES.indexOf(S.stage));
    for (let id = 0; id < n; id++) {
      const S = systems[id];
      if (stageOf[id] < 0) throw new Error(`system ${S.key}: unknown stage '${S.stage}'`);
      if (!PARALLEL.includes(S.parallel)) throw new Error(`system ${S.key}: parallel must be 'auto', 'serial' or 'chunks'`);
      if (!S.query && S.parallel === 'chunks') throw new Error(`system ${S.key}: parallel 'chunks' needs a query`);
      for (const K of [...S.reads, ...S.writes]) {
        reg.id(K);
        if (K.renderOnly && S.stage !== 'Extract') throw new Error(`system ${S.key}: sim systems may not read or write the render-only component ${K.key}`);
      }
      if (S.query) for (const K of [...(S.query.all ?? []), ...(S.query.none ?? []), ...(S.query.any ?? []), ...(S.query.changed ?? [])]) reg.id(K);
    }

    /** @param {SystemClass | string} ref */
    const resolve = (ref) => (typeof ref === 'string' ? systems.findIndex((S) => S.key === ref) : (manifest.systemIds.get(ref) ?? -1));
    /** @type {Set<number>[]} */
    const succ = Array.from({ length: n }, () => new Set());
    /** @type {[number, number, 'explicit' | 'conflict'][]} */
    const edges = [];
    /** @param {number} a @param {number} b */
    const addEdge = (a, b) => {
      if (stageOf[a] !== stageOf[b]) {
        // Stages already order these; an edge against the stage order can never hold.
        if (stageOf[a] > stageOf[b]) throw new Error(`system ${systems[a].key} (${systems[a].stage}) can't run before ${systems[b].key} (${systems[b].stage})`);
        return;
      }
      if (!succ[a].has(b)) {
        succ[a].add(b);
        edges.push([a, b, 'explicit']);
      }
    };
    for (let id = 0; id < n; id++) {
      for (const ref of systems[id].after) {
        const j = resolve(ref);
        if (j < 0) throw new Error(`system ${systems[id].key}: 'after' names an unknown system`);
        addEdge(j, id);
      }
      for (const ref of systems[id].before) {
        const j = resolve(ref);
        if (j < 0) throw new Error(`system ${systems[id].key}: 'before' names an unknown system`);
        addEdge(id, j);
      }
    }

    const order = /** @type {Record<Stage, number[]>} */ ({});
    const warnings = [];
    for (let si = 0; si < STAGES.length; si++) {
      const nodes = [];
      for (let id = 0; id < n; id++) if (stageOf[id] === si) nodes.push(id);
      const indeg = new Map(nodes.map((id) => [id, 0]));
      for (const a of nodes) for (const b of succ[a]) indeg.set(b, /** @type {number} */ (indeg.get(b)) + 1);
      const ready = nodes.filter((id) => indeg.get(id) === 0); // ascending
      /** @type {number[]} */
      const out = [];
      while (ready.length) {
        const id = /** @type {number} */ (ready.shift()); // lowest ready system ID
        out.push(id);
        for (const b of succ[id]) {
          const d = /** @type {number} */ (indeg.get(b)) - 1;
          indeg.set(b, d);
          if (d === 0) {
            let k = 0;
            while (k < ready.length && ready[k] < b) k++;
            ready.splice(k, 0, b);
          }
        }
      }
      if (out.length < nodes.length) {
        const stuck = nodes.filter((id) => !out.includes(id)).map((id) => systems[id].key);
        throw new Error(`system cycle in stage ${STAGES[si]}: ${stuck.join(', ')}`);
      }
      order[STAGES[si]] = out;

      // Conflict edges follow the serial order, so they can't create a cycle.
      const reach = Scheduler.#reachability(out, succ);
      for (let i = 0; i < out.length; i++) {
        for (let j = i + 1; j < out.length; j++) {
          const what = Scheduler.#conflict(systems[out[i]], systems[out[j]]);
          if (!what) continue;
          edges.push([out[i], out[j], 'conflict']);
          if (!reach[i].has(out[j])) {
            warnings.push(`${systems[out[i]].key} and ${systems[out[j]].key} both touch ${what} with no explicit order; ${systems[out[i]].key} runs first (lower system ID)`);
          }
        }
      }
    }
    return { order, edges, warnings };
  }

  /** Systems reachable from each node through explicit edges. @param {number[]} nodes @param {Set<number>[]} succ */
  static #reachability(nodes, succ) {
    return nodes.map((start) => {
      const seen = new Set();
      const stack = [...succ[start]];
      while (stack.length) {
        const id = /** @type {number} */ (stack.pop());
        if (seen.has(id)) continue;
        seen.add(id);
        stack.push(...succ[id]);
      }
      return seen;
    });
  }

  /** Name of what two systems conflict on, or ''. @param {SystemClass} a @param {SystemClass} b */
  static #conflict(a, b) {
    /** @param {{ key?: string, name: string }[]} writes @param {{ key?: string, name: string }[]} other */
    const hit = (writes, other) => writes.find((x) => other.includes(x));
    const c =
      hit(a.writes, [...b.reads, ...b.writes]) ??
      hit(b.writes, [...a.reads, ...a.writes]) ??
      hit(/** @type {any[]} */ (a.writesEvents), [...b.readsEvents, ...b.writesEvents]) ??
      hit(/** @type {any[]} */ (b.writesEvents), [...a.readsEvents, ...a.writesEvents]);
    return c ? c.key || c.name : '';
  }
}
