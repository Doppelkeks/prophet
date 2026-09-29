// @ts-check
import { D, FLAG_PARALLEL_FOR, S } from './job-queue.js';

/** @typedef {(job: number, key: string, error: unknown) => void} JobErrorHandler */

/** Runs popped descriptors. Shared by job workers and the engine thread (which helps drain). */
export class JobExecutor {
  /**
   * @param {import('./kernel.js').JobContext} ctx
   * @param {import('./kernel.js').KernelRegistry} registry
   * @param {JobErrorHandler} onError called when a kernel throws; the job is marked failed either way
   */
  constructor(ctx, registry, onError) {
    this.ctx = ctx;
    this.registry = registry;
    this.onError = onError;
    this.args = new Int32Array(6);
  }

  /** @param {Int32Array} d a popped 16-word descriptor */
  execute(d) {
    const i32 = this.ctx.heap.i32;
    const kernel = this.registry.get(d[D.KERNEL] & 0xffff);
    const flags = d[D.KERNEL] >>> 16;
    const slot = d[D.SLOT];
    const args = this.args;
    for (let a = 0; a < 6; a++) args[a] = d[D.ARGS + a];
    try {
      if (flags & FLAG_PARALLEL_FOR) {
        // Claim `grain` items at a time until the shared cursor passes the end (dynamic load balancing).
        const end = d[D.END];
        const grain = d[D.GRAIN];
        for (;;) {
          const i = Atomics.add(i32, slot + S.CURSOR, grain);
          if (i >= end) break;
          kernel.run(this.ctx, args, i, i + grain < end ? i + grain : end);
        }
      } else {
        kernel.run(this.ctx, args, d[D.BEGIN], d[D.END]);
      }
    } catch (err) {
      Atomics.store(i32, slot + S.STATUS, 1);
      this.onError(d[D.JOB], /** @type {typeof import('./kernel.js').Kernel} */ (kernel.constructor).key, err);
    }
    // Each descriptor holds one count, so a slot is only reused after every copy of its descriptor ran.
    if (Atomics.sub(i32, slot + S.COUNTER, 1) === 1) Atomics.notify(i32, slot + S.COUNTER);
  }
}
