// @ts-check
import { Hash32 } from '../core/hash32.js';

/**
 * @typedef {object} JobContext
 * @property {import('../core/heap.js').Heap} heap the heap this job runs on (the shared heap, or a transfer-tier copy)
 * @property {number} worker executor index: -1 for the engine thread, 0..N-1 for job workers
 */

/**
 * A job kernel: a pure function over heap regions (docs/engine/02-core-ecs-jobs.md#job-system).
 * The same kernel runs unchanged in the shared, transfer and inline threading tiers, so it may only
 * touch memory through `ctx.heap` at the byte offsets it receives in `args`.
 */
export class Kernel {
  /** Stable manifest key. Never derived from the class name (minification renames classes). */
  static key = '';

  /**
   * @param {JobContext} ctx
   * @param {Int32Array} args six argument words (usually byte offsets into the heap)
   * @param {number} begin first item of this slice
   * @param {number} end one past the last item
   */
  run(ctx, args, begin, end) {
    throw new Error(`kernel ${/** @type {typeof Kernel} */ (this.constructor).key} has no run()`);
  }
}

/** Numbers kernels by sorted key, identically on every thread, and hashes the list for manifest checks. */
export class KernelRegistry {
  /** @param {(typeof Kernel)[]} kernels */
  constructor(kernels) {
    const sorted = [...kernels].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    /** @type {Map<typeof Kernel, number>} */
    this.ids = new Map();
    /** @type {Kernel[]} */
    this.instances = [];
    let h = Hash32.begin(0x4b45524e); // 'KERN'
    let words = 0;
    for (let i = 0; i < sorted.length; i++) {
      const K = sorted[i];
      if (!K.key) throw new Error('kernel without a static key');
      if (i > 0 && sorted[i - 1].key === K.key) throw new Error(`duplicate kernel key ${K.key}`);
      this.ids.set(K, i);
      this.instances.push(new K());
      for (let c = 0; c < K.key.length; c++, words++) h = Hash32.step(h, K.key.charCodeAt(c));
      h = Hash32.step(h, 0);
      words++;
    }
    this.hash = Hash32.end(h, words);
  }

  /** @param {typeof Kernel} K */
  id(K) {
    const id = this.ids.get(K);
    if (id === undefined) throw new Error(`kernel ${K.key} is not registered`);
    return id;
  }

  /** @param {number} id */
  get(id) {
    const k = this.instances[id];
    if (!k) throw new Error(`unknown kernel id ${id}`);
    return k;
  }
}
