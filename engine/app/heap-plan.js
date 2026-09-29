// @ts-check
// Carves the jobs arena (docs/engine/02-core-ecs-jobs.md#arenas-and-allocators): the job queue, the
// input ring and the UI state block first, then everything left for the ECS command buffers.
import { BumpArena } from '../core/arenas.js';
import { InputRing } from '../input/input-ring.js';
import { JobQueue } from '../jobs/job-queue.js';

/** @typedef {{ off: number, size: number }} Region */

export class HeapPlan {
  /**
   * @param {import('../core/heap.js').Heap} heap
   * @param {number} stateBytes size of the UI state block
   * @returns {{ queue: Region, input: Region, state: Region, commands: Region }}
   */
  static carve(heap, stateBytes) {
    const jobs = heap.arena('jobs');
    const bump = new BumpArena(jobs);
    const take = (/** @type {number} */ bytes) => {
      const size = (bytes + 63) & ~63;
      const off = bump.alloc(size, 64);
      if (off < 0) throw new Error('heap-arena-exhausted: the jobs arena is too small');
      return { off, size };
    };
    const queue = take(JobQueue.bytes());
    const input = take(InputRing.bytes());
    const state = take(stateBytes);
    const rest = (jobs.off + jobs.size - ((bump.top + 63) & ~63)) & ~63;
    return { queue, input, state, commands: take(rest) };
  }
}
