// @ts-check
// A fixed mix of parallel-for and async jobs whose outputs are hashed. Every threading tier and worker
// count must produce the same hash (docs/engine/02-core-ecs-jobs.md#testing: tier equivalence).
import { BumpArena } from '../../engine/core/arenas.js';
import { Hash32 } from '../../engine/core/hash32.js';
import { Rng } from '../../engine/core/rng.js';
import { BlurKernel, SliceSumKernel, SquareKernel } from './test-kernels.js';

export class JobScenario {
  static N = 60000;
  static SLICE = 1000;

  /**
   * @param {import('../../engine/jobs/job-system.js').JobSystem} jobs
   * @returns {Promise<number>} hash over every output region
   */
  static async run(jobs) {
    const { N, SLICE } = JobScenario;
    const heap = jobs.heap;
    const arena = new BumpArena(heap.arena('ecs'));
    const src = arena.alloc(N * 4, 64);
    const sq = arena.alloc(N * 4, 64);
    const sums = arena.alloc(Math.ceil(N / SLICE) * 4, 64);
    const blur = arena.alloc(N * 4, 64);
    const blur2 = arena.alloc(N * 4, 64);
    const key = Rng.key(0x5eed, 7);
    for (let i = 0; i < N; i++) heap.i32[(src >> 2) + i] = Rng.u32(key, 0, i) | 0;

    // Frame-critical parallel-fors, one stage after the other (the second reads the first's output).
    await jobs.wait(jobs.parallelFor(SquareKernel, [src, sq], 0, N, 257));
    await jobs.wait(jobs.parallelFor(SliceSumKernel, [sq, sums, SLICE], 0, N, SLICE));

    // Two async jobs in flight together; the second only writes part of a `readwrite` region.
    const a = jobs.submit(BlurKernel, {
      args: [sq, blur, N, 0x1234],
      begin: 0,
      end: N,
      regions: [
        { arg: 0, bytes: N * 4, access: 'read' },
        { arg: 1, bytes: N * 4, access: 'write' },
      ],
    });
    const b = jobs.submit(BlurKernel, {
      args: [src, blur2, N, 0x4321],
      begin: 100,
      end: N - 100,
      regions: [
        { arg: 0, bytes: N * 4, access: 'read' },
        { arg: 1, bytes: N * 4, access: 'readwrite' },
      ],
    });
    await jobs.wait(a);
    await jobs.wait(b);

    let h = 0;
    for (const [off, words] of [
      [sq, N],
      [sums, Math.ceil(N / SLICE)],
      [blur, N],
      [blur2, N],
    ]) {
      h = Hash32.words(heap.i32, off >> 2, words, h);
    }
    return h >>> 0;
  }
}
