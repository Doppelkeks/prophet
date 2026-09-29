// @ts-check
// Systems (docs/engine/02-core-ecs-jobs.md#scheduler). A system declares, as static fields, its stage,
// what it reads and writes, its ordering constraints, its query and its parallelism. Systems with a
// query get `run(chunk, cmd)` once per matching ECS chunk; systems without one get `update(cmd)` once
// per tick (or per frame in Extract).
//
// Rules that keep serial and chunk-parallel runs identical:
// - write in place only to the current row, and only to components in `writes`;
// - never read another entity's copy of a component this system writes in place;
// - every other change (other entities, spawns, adds, removes) goes through the command buffer;
// - keep no mutable state in the instance, apart from per-thread scratch.

/** @typedef {'Input' | 'PreSim' | 'Sim' | 'PostSim' | 'Extract'} Stage */
/** @typedef {typeof import('./component.js').Component} ComponentClass */
/**
 * @typedef {object} QueryDesc
 * @property {ComponentClass[]} [all] every one of these
 * @property {ComponentClass[]} [none] none of these
 * @property {ComponentClass[]} [any] at least one of these (when non-empty)
 * @property {ComponentClass[]} [changed] visit only chunks where one of these changed since the system last ran
 */

/**
 * What a system instance gets at init, on whichever thread it runs.
 * @typedef {object} EcsContext
 * @property {import('../core/heap.js').Heap} heap
 * @property {import('./ecs-reader.js').EcsReader} reader read access to any entity (thread-safe during a stage)
 * @property {number} participant 0 = engine thread, i + 1 = job worker i
 * @property {Record<string, any>} resources engine-thread-only services (input, swarm backend); empty on job workers
 */

export class System {
  /** Stable manifest key; the system ID is its position in key order. */
  static key = '';
  /** @type {Stage} */
  static stage = 'Sim';
  /** @type {ComponentClass[]} */
  static reads = [];
  /** @type {ComponentClass[]} components written in place (current row only) */
  static writes = [];
  /** @type {Function[]} event types (event channels arrive in a later increment) */
  static readsEvents = [];
  /** @type {Function[]} */
  static writesEvents = [];
  /** @type {(typeof System | string)[]} systems (or keys) this one runs after */
  static after = [];
  /** @type {(typeof System | string)[]} systems (or keys) this one runs before */
  static before = [];
  /** @type {QueryDesc | null} */
  static query = null;
  /** @type {'auto' | 'serial' | 'chunks'} */
  static parallel = 'auto';

  constructor() {
    /** @type {EcsContext} set by init() before the first run */
    this.ecs = /** @type {any} */ (null);
    /** @type {import('../core/heap.js').Heap} */
    this.heap = /** @type {any} */ (null);
  }

  /** @param {EcsContext} ecs */
  init(ecs) {
    this.ecs = ecs;
    this.heap = ecs.heap;
  }

  /**
   * Called once per matching ECS chunk (systems with a query).
   * @param {import('./chunk-view.js').ChunkView} c
   * @param {import('./command-buffer.js').CommandWriter} cmd this chunk visit's command segment
   */
  run(c, cmd) {}

  /**
   * Called once per run (systems without a query). Engine thread only.
   * @param {import('./command-buffer.js').CommandWriter} cmd
   */
  update(cmd) {}
}

/** @typedef {typeof System} SystemClass */
