// @ts-check
// Job queue in the jobs arena (docs/engine/02-core-ecs-jobs.md#queue-layout): two bounded
// multi-producer/multi-consumer rings (Vyukov's algorithm with per-cell sequence numbers), a wake
// word, a stop flag, and a ring of job slots holding each job's claim cursor, completion counter
// and status. Every thread builds its own JobQueue object over the same shared words.

/** Descriptor words (16 x i32 = one 64-byte cell). */
export const D = Object.freeze({ SEQ: 0, KERNEL: 1, ARGS: 2, BEGIN: 8, END: 9, GRAIN: 10, SLOT: 11, JOB: 12 });
/** Job-slot words: cursor, completion counter, status (0 = ok, otherwise failed). */
export const S = Object.freeze({ CURSOR: 0, COUNTER: 1, STATUS: 2, JOB: 3 });
export const FLAG_PARALLEL_FOR = 1;

const LINE = 16; // words per 64-byte line

export class JobQueue {
  static CAP = 1024; // cells per lane (power of two)
  static SLOTS = 1024; // concurrently tracked jobs
  static LANES = 2;
  static CRIT = 0; // frame-critical lane (the engine thread helps drain it)
  static BG = 1; // background lane (job workers only)

  /** Bytes the queue needs in the jobs arena (a multiple of 64). */
  static bytes() {
    return (LINE * 32 + JobQueue.LANES * JobQueue.CAP * LINE + JobQueue.SLOTS * LINE) * 4;
  }

  /** The queue's default place: the start of the jobs arena. The rest of the arena is free for other rings. @param {import('../core/heap.js').Heap} heap */
  static region(heap) {
    return { off: heap.arena('jobs').off, size: JobQueue.bytes() };
  }

  /**
   * @param {import('../core/heap.js').Heap} heap
   * @param {{ off: number, size: number }} region the jobs arena (or a part of it)
   */
  constructor(heap, region) {
    if (region.size < JobQueue.bytes()) throw new Error('jobs arena too small for the job queue');
    this.i32 = heap.i32;
    const base = region.off >> 2;
    this.headW = [base, base + LINE * 2];
    this.tailW = [base + LINE, base + LINE * 3];
    this.wakeW = base + LINE * 4;
    this.stopW = base + LINE * 5;
    this.readyW = base + LINE * 6;
    this.cellsW = [base + LINE * 32, base + LINE * 32 + JobQueue.CAP * LINE];
    this.slotsW = base + LINE * 32 + JobQueue.LANES * JobQueue.CAP * LINE;
  }

  /** Initializes the shared words. Engine thread only, before any worker attaches. */
  format() {
    const i32 = this.i32;
    for (let lane = 0; lane < JobQueue.LANES; lane++) {
      Atomics.store(i32, this.headW[lane], 0);
      Atomics.store(i32, this.tailW[lane], 0);
      for (let c = 0; c < JobQueue.CAP; c++) Atomics.store(i32, this.cellsW[lane] + c * LINE + D.SEQ, c);
    }
    Atomics.store(i32, this.wakeW, 0);
    Atomics.store(i32, this.stopW, 0);
    Atomics.store(i32, this.readyW, 0);
    i32.fill(0, this.slotsW, this.slotsW + JobQueue.SLOTS * LINE);
  }

  /** Word index of job slot `slot`. @param {number} slot */
  slotWord(slot) {
    return this.slotsW + slot * LINE;
  }

  /**
   * Pushes a descriptor. Returns false when the lane is full.
   * @param {number} lane @param {number} kernel @param {number} flags @param {ArrayLike<number>} args
   * @param {number} begin @param {number} end @param {number} grain @param {number} slotWord @param {number} jobId
   */
  push(lane, kernel, flags, args, begin, end, grain, slotWord, jobId) {
    const i32 = this.i32;
    const tailW = this.tailW[lane];
    const cells = this.cellsW[lane];
    let pos = Atomics.load(i32, tailW);
    for (;;) {
      const cell = cells + (pos & (JobQueue.CAP - 1)) * LINE;
      const dif = (Atomics.load(i32, cell + D.SEQ) - pos) | 0;
      if (dif === 0) {
        if (Atomics.compareExchange(i32, tailW, pos, (pos + 1) | 0) === pos) {
          i32[cell + D.KERNEL] = (kernel & 0xffff) | (flags << 16);
          for (let a = 0; a < 6; a++) i32[cell + D.ARGS + a] = args[a] | 0;
          i32[cell + D.BEGIN] = begin;
          i32[cell + D.END] = end;
          i32[cell + D.GRAIN] = grain;
          i32[cell + D.SLOT] = slotWord;
          i32[cell + D.JOB] = jobId;
          Atomics.store(i32, cell + D.SEQ, (pos + 1) | 0); // publishes the payload
          return true;
        }
        pos = Atomics.load(i32, tailW);
      } else if (dif < 0) {
        return false;
      } else {
        pos = Atomics.load(i32, tailW);
      }
    }
  }

  /**
   * Pops a descriptor into `out` (16 words). Returns false when the lane is empty.
   * @param {number} lane @param {Int32Array} out
   */
  pop(lane, out) {
    const i32 = this.i32;
    const headW = this.headW[lane];
    const cells = this.cellsW[lane];
    let pos = Atomics.load(i32, headW);
    for (;;) {
      const cell = cells + (pos & (JobQueue.CAP - 1)) * LINE;
      const dif = (Atomics.load(i32, cell + D.SEQ) - ((pos + 1) | 0)) | 0;
      if (dif === 0) {
        if (Atomics.compareExchange(i32, headW, pos, (pos + 1) | 0) === pos) {
          for (let w = 0; w < LINE; w++) out[w] = i32[cell + w];
          Atomics.store(i32, cell + D.SEQ, (pos + JobQueue.CAP) | 0); // frees the cell
          return true;
        }
        pos = Atomics.load(i32, headW);
      } else if (dif < 0) {
        return false;
      } else {
        pos = Atomics.load(i32, headW);
      }
    }
  }

  /** Wakes up to `count` sleeping job workers. @param {number} count */
  wake(count) {
    Atomics.add(this.i32, this.wakeW, 1);
    Atomics.notify(this.i32, this.wakeW, count);
  }
}
