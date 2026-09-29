// @ts-check
// Kernels for the job-system tests, shared by Node (worker_threads) and the browser (jobs.spec).
import { Kernel, KernelRegistry } from '../../engine/jobs/kernel.js';
import { Rng } from '../../engine/core/rng.js';

/** Burns a few microseconds so that threads interleave differently from run to run. @param {number} n */
export function spin(n) {
  let h = 0;
  for (let k = 0; k < n; k++) h = Rng.mix32(h + k);
  return h;
}

/** dst[i] = src[i]² + i (wrapping). args: [src, dst] byte offsets. */
export class SquareKernel extends Kernel {
  static key = 'test.square';
  /** @type {Kernel['run']} */
  run(ctx, args, begin, end) {
    const i32 = ctx.heap.i32;
    const src = args[0] >> 2;
    const dst = args[1] >> 2;
    for (let i = begin; i < end; i++) {
      const v = i32[src + i];
      i32[dst + i] = (Math.imul(v, v) + i) | 0;
    }
  }
}

/** Counts executions per item. args: [hits byte offset, jitter seed (0 = none)]. */
export class CountKernel extends Kernel {
  static key = 'test.count';
  /** @type {Kernel['run']} */
  run(ctx, args, begin, end) {
    const i32 = ctx.heap.i32;
    const hits = args[0] >> 2;
    for (let i = begin; i < end; i++) {
      Atomics.add(i32, hits + i, 1);
      if (args[1]) spin(Rng.mix32(args[1] ^ i) & 511);
    }
  }
}

/** One checksum per slice: out[begin / grain] = rolling hash of src[begin..end). args: [src, out, grain]. */
export class SliceSumKernel extends Kernel {
  static key = 'test.slice-sum';
  /** @type {Kernel['run']} */
  run(ctx, args, begin, end) {
    const i32 = ctx.heap.i32;
    const src = args[0] >> 2;
    let h = 0x811c9dc5;
    for (let i = begin; i < end; i++) h = Math.imul(h ^ i32[src + i], 0x01000193);
    i32[(args[1] >> 2) + Math.floor(begin / args[2])] = h | 0;
  }
}

/** An async-style job with separate input and output regions and immediates. args: [src, dst, n, salt]. */
export class BlurKernel extends Kernel {
  static key = 'test.blur';
  /** @type {Kernel['run']} */
  run(ctx, args, begin, end) {
    const i32 = ctx.heap.i32;
    const src = args[0] >> 2;
    const dst = args[1] >> 2;
    const n = args[2];
    for (let i = begin; i < end; i++) {
      const l = i > 0 ? i32[src + i - 1] : 0;
      const r = i + 1 < n ? i32[src + i + 1] : 0;
      i32[dst + i] = Rng.mix32(l ^ Math.imul(i32[src + i], 3) ^ r ^ args[3]) | 0;
    }
  }
}

/** Throws when its slice reaches item args[0]. */
export class ThrowKernel extends Kernel {
  static key = 'test.throw';
  /** @type {Kernel['run']} */
  run(ctx, args, begin, end) {
    if (end > args[0]) throw new Error(`test kernel failure in slice ${begin}..${end}`);
  }
}

/** Only in the stale bundle below. */
export class StaleKernel extends Kernel {
  static key = 'test.stale';
}

export const TEST_KERNELS = [SquareKernel, CountKernel, SliceSumKernel, BlurKernel, ThrowKernel];

export function testRegistry() {
  return new KernelRegistry(TEST_KERNELS);
}

/** The kernel list as an out-of-date worker bundle would register it. */
export function staleRegistry() {
  return new KernelRegistry([...TEST_KERNELS.filter((K) => K !== ThrowKernel), StaleKernel]);
}
