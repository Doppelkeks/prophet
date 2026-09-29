// @ts-check
// The engine side of the job system (docs/engine/02-core-ecs-jobs.md#job-system): one API over the three
// threading tiers.
//   shared   Descriptors go into the job queue in the heap and kernels run in place on the job workers.
//            The engine thread helps drain the frame-critical lane while it waits.
//   transfer Async jobs copy their regions into transferable buffers (TransferDispatcher);
//            parallel-for runs serially on the engine thread.
//   inline   Everything runs synchronously on the calling thread (tests, reference runs). Never shipped.
// The engine thread never blocks: waiting yields with Atomics.waitAsync, or a timer where it is missing.
import { FLAG_PARALLEL_FOR, JobQueue, S } from './job-queue.js';
import { JobExecutor } from './job-executor.js';
import { TransferDispatcher } from './transfer-dispatcher.js';

/** @typedef {import('../platform/tiers.js').ThreadingTier} ThreadingTier */
/** @typedef {import('./transfer-dispatcher.js').JobRegion} JobRegion */
/** @typedef {import('./worker-port.js').WorkerHandle} WorkerHandle */
/** @typedef {typeof import('./kernel.js').Kernel} KernelClass */

/**
 * @typedef {object} JobSystemOptions
 * @property {ThreadingTier} tier
 * @property {import('../core/heap.js').Heap} heap shared in the `shared` tier
 * @property {import('./kernel.js').KernelRegistry} registry the same kernel list the job workers import
 * @property {number} [workers] job workers to spawn (ignored in the `inline` tier)
 * @property {(index: number) => WorkerHandle} [spawn] starts job worker `index`
 * @property {{ off: number, size: number }} [region] heap region for the job queue (default: the jobs arena)
 * @property {number} [waitMs] job-worker sleep timeout; a safety net only, since producers always notify
 * @property {import('./job-executor.js').JobErrorHandler} [onJobError] a kernel threw (default: console.error)
 */

/** A submitted job. Pass every handle to `JobSystem.wait` exactly once: that frees its job slot. */
export class JobHandle {
  /** @param {number} id @param {string} key */
  constructor(id, key) {
    this.id = id;
    this.key = key;
    /** Queue lane in the `shared` tier, -1 otherwise. */
    this.lane = -1;
    /** Job slot in the `shared` tier, -1 otherwise. */
    this.slot = -1;
    /** @type {Promise<void> | null} completion in the `transfer` tier */
    this.promise = null;
    /** Set when a transfer-tier job has returned. */
    this.settled = false;
    /** Failure of a job that already ran synchronously; '' when it succeeded. */
    this.error = '';
    this.waited = false;
  }
}

export class JobSystem {
  static READY_TIMEOUT_MS = 15000;
  static STOP_TIMEOUT_MS = 2000;
  /** Upper bound on one Atomics.waitAsync; the loop re-checks the counter after it. */
  static WAIT_SLICE_MS = 100;

  /**
   * Creates the job system and starts its workers.
   * @param {JobSystemOptions} options
   */
  static async create(options) {
    const jobs = new JobSystem(options);
    const count = options.tier === 'inline' ? 0 : (options.workers ?? 0);
    if (count > 0) {
      if (!options.spawn) throw new Error('JobSystem.create: workers need a spawn function');
      await jobs.#spawn(count, options.spawn, options.waitMs ?? 50);
    }
    return jobs;
  }

  /** Use `JobSystem.create`. @param {JobSystemOptions} options */
  constructor(options) {
    this.tier = options.tier;
    this.heap = options.heap;
    this.registry = options.registry;
    this.region = options.region ?? options.heap.arena('jobs');
    this.onJobError =
      options.onJobError ??
      ((job, key, err) => {
        console.error(`[prophet] job ${job} (${key}) failed:`, err);
      });
    /** @type {WorkerHandle[]} */
    this.workers = [];
    /** @type {JobQueue | null} */
    this.queue = null;
    /** @type {TransferDispatcher | null} */
    this.dispatcher = null;
    this.stopped = 0;
    this.ctx = { heap: this.heap, worker: -1 };
    if (this.tier === 'shared') {
      if (!this.heap.shared) throw new Error('the shared threading tier needs a shared heap');
      this.queue = new JobQueue(this.heap, this.region);
      this.queue.format();
    }
    this.exec = new JobExecutor(this.ctx, this.registry, (job, key, err) => this.onJobError(job, key, err));
    /** @type {number[]} free job slots, lowest on top */
    this.#freeSlots = [];
    for (let s = JobQueue.SLOTS - 1; s >= 0; s--) this.#freeSlots.push(s);
  }

  /** @type {number[]} */
  #freeSlots;
  #jobId = 0;
  #desc = new Int32Array(16);
  #args = new Int32Array(6);
  /** @type {{ resolve: () => void, reject: (err: Error) => void }[]} */
  #starting = [];
  /** @type {(() => void) | null} */
  #onAllStopped = null;

  /**
   * Splits `[begin, end)` into `grain`-sized slices that every participant claims from one atomic cursor
   * (frame-critical lane). The kernel always sees the same slices, whichever tier or thread runs them.
   * @param {KernelClass} K
   * @param {ArrayLike<number>} args six argument words
   * @param {number} begin
   * @param {number} end
   * @param {number} [grain] items per claim
   * @returns {JobHandle}
   */
  parallelFor(K, args, begin, end, grain = 1) {
    const kernel = this.registry.id(K);
    const handle = new JobHandle(this.#nextJobId(), K.key);
    grain = Math.max(1, grain | 0);
    if (end <= begin) return handle;
    const queue = this.queue;
    if (!queue) {
      this.#runSlices(handle, kernel, args, begin, end, grain);
      return handle;
    }
    // One descriptor per participant (never one per slice). Each carries one count, so the slot is
    // released only after every copy ran, and a late worker can never claim from a reused slot.
    const fanout = Math.min(this.workers.length + 1, Math.ceil((end - begin) / grain));
    if (end + (fanout + 1) * grain > 0x7fffffff) throw new RangeError('parallelFor: range too large for the claim cursor');
    const sw = queue.slotWord(this.#takeSlot(handle, JobQueue.CRIT));
    const i32 = this.heap.i32;
    Atomics.store(i32, sw + S.CURSOR, begin);
    Atomics.store(i32, sw + S.STATUS, 0);
    Atomics.store(i32, sw + S.JOB, handle.id);
    Atomics.store(i32, sw + S.COUNTER, fanout);
    for (let f = 0; f < fanout; f++) this.#push(JobQueue.CRIT, kernel, FLAG_PARALLEL_FOR, args, begin, end, grain, sw, handle.id);
    if (this.workers.length) queue.wake(Math.min(fanout, this.workers.length));
    return handle;
  }

  /**
   * Submits one asynchronous job (background lane): the kernel runs once over `[begin, end)`.
   * `regions` name the heap regions it touches; the `transfer` tier copies them, the others ignore them.
   * @param {KernelClass} K
   * @param {{ args: ArrayLike<number>, begin?: number, end?: number, regions?: JobRegion[] }} job
   * @returns {JobHandle}
   */
  submit(K, job) {
    const kernel = this.registry.id(K);
    const handle = new JobHandle(this.#nextJobId(), K.key);
    const { args, begin = 0, end = 1, regions = [] } = job;
    if (this.queue) {
      const sw = this.queue.slotWord(this.#takeSlot(handle, JobQueue.BG));
      const i32 = this.heap.i32;
      Atomics.store(i32, sw + S.CURSOR, 0);
      Atomics.store(i32, sw + S.STATUS, 0);
      Atomics.store(i32, sw + S.JOB, handle.id);
      Atomics.store(i32, sw + S.COUNTER, 1);
      this.#push(JobQueue.BG, kernel, 0, args, begin, end, 0, sw, handle.id);
      if (this.workers.length) this.queue.wake(1);
    } else if (this.dispatcher) {
      handle.promise = this.dispatcher.run(handle.id, kernel, K.key, args, begin, end, regions);
      handle.promise.then(
        () => (handle.settled = true),
        (err) => {
          handle.settled = true;
          this.onJobError(handle.id, handle.key, err);
        },
      );
    } else {
      this.#runSlices(handle, kernel, args, begin, end, Math.max(1, end - begin), true);
    }
    return handle;
  }

  /**
   * Waits for a job without blocking the thread; throws `job-failed` if a kernel threw.
   * While waiting on a frame-critical job (or when there are no job workers) the engine thread helps
   * by running descriptors from that lane itself.
   * @param {JobHandle} handle
   */
  async wait(handle) {
    if (handle.waited) throw new Error(`job ${handle.id} (${handle.key}) was already waited for`);
    handle.waited = true;
    if (handle.promise) return handle.promise;
    if (handle.slot < 0) {
      if (handle.error) throw new Error(`job-failed: job ${handle.id} (${handle.key}): ${handle.error}`);
      return;
    }
    const queue = /** @type {JobQueue} */ (this.queue);
    const i32 = this.heap.i32;
    const counter = queue.slotWord(handle.slot) + S.COUNTER;
    const help = handle.lane === JobQueue.CRIT || this.workers.length === 0;
    for (;;) {
      const c = Atomics.load(i32, counter);
      if (c === 0) break;
      if (help && queue.pop(handle.lane, this.#desc)) {
        this.exec.execute(this.#desc);
        continue;
      }
      await JobSystem.#sleep(i32, counter, c);
    }
    const failed = Atomics.load(i32, queue.slotWord(handle.slot) + S.STATUS) !== 0;
    this.#freeSlots.push(handle.slot);
    if (failed) throw new Error(`job-failed: job ${handle.id} (${handle.key})`);
  }

  /** Whether a job has finished (it still has to be waited for). @param {JobHandle} handle */
  isDone(handle) {
    if (handle.promise) return handle.settled;
    if (handle.slot < 0 || !this.queue) return true;
    return Atomics.load(this.heap.i32, this.queue.slotWord(handle.slot) + S.COUNTER) === 0;
  }

  /**
   * Runs up to `max` queued descriptors of a lane on this thread (the engine's frame tail, or tests).
   * @param {number} lane JobQueue.CRIT or JobQueue.BG
   * @param {number} [max]
   * @returns {number} descriptors run
   */
  drain(lane, max = Infinity) {
    let n = 0;
    while (this.queue && n < max && this.queue.pop(lane, this.#desc)) {
      this.exec.execute(this.#desc);
      n++;
    }
    return n;
  }

  /** Job slots currently held by handles that were not waited for yet. */
  get slotsInUse() {
    return JobQueue.SLOTS - this.#freeSlots.length;
  }

  /** Stops the job workers (shared tier: through the stop flag) and terminates them. */
  async shutdown() {
    const queue = this.queue;
    if (queue && this.workers.length && this.stopped < this.workers.length) {
      /** @type {Promise<void>} */
      const allStopped = new Promise((resolve) => {
        this.#onAllStopped = resolve;
      });
      Atomics.store(this.heap.i32, queue.stopW, 1);
      queue.wake(this.workers.length);
      /** @type {ReturnType<typeof setTimeout> | undefined} */
      let timer;
      const timeout = new Promise((resolve) => {
        timer = setTimeout(resolve, JobSystem.STOP_TIMEOUT_MS);
      });
      await Promise.race([allStopped, timeout]);
      clearTimeout(timer);
    }
    this.dispatcher?.failAll('the job system shut down');
    this.#terminate();
  }

  /**
   * @param {number} count
   * @param {(index: number) => WorkerHandle} spawn
   * @param {number} waitMs
   */
  async #spawn(count, spawn, waitMs) {
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    try {
      /** @type {Promise<void>[]} */
      const ready = [];
      for (let i = 0; i < count; i++) {
        ready.push(
          new Promise((resolve, reject) => {
            this.#starting[i] = { resolve, reject };
          }),
        );
        const handle = spawn(i);
        this.workers.push(handle);
        handle.onMessage((msg) => this.#onMessage(i, msg));
        handle.post(
          this.tier === 'shared'
            ? { type: 'init', mode: 'shared', index: i, manifest: this.registry.hash, buffer: this.heap.buffer, jobs: this.region, waitMs }
            : { type: 'init', mode: 'transfer', index: i, manifest: this.registry.hash },
        );
      }
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`job workers did not start within ${JobSystem.READY_TIMEOUT_MS} ms`)), JobSystem.READY_TIMEOUT_MS);
      });
      await Promise.race([Promise.all(ready), timeout]);
    } catch (err) {
      if (this.queue) Atomics.store(this.heap.i32, this.queue.stopW, 1);
      this.#terminate();
      throw err;
    } finally {
      clearTimeout(timer);
      this.#starting = [];
    }
    if (this.tier === 'transfer') this.dispatcher = new TransferDispatcher(this.heap, this.workers);
  }

  /** @param {number} index @param {any} msg */
  #onMessage(index, msg) {
    switch (msg.type) {
      case 'ready':
        this.#starting[index]?.resolve();
        break;
      case 'done':
        this.dispatcher?.onDone(msg);
        break;
      case 'job-error':
        this.onJobError(msg.job, msg.key, new Error(msg.message));
        break;
      case 'stopped':
        this.stopped++;
        if (this.stopped === this.workers.length) this.#onAllStopped?.();
        break;
      case 'error': {
        const err = new Error(msg.message);
        const starting = this.#starting[index];
        if (starting) starting.reject(err);
        else {
          console.error(`[prophet] job worker ${index} failed:`, err);
          this.dispatcher?.failAll(`job worker ${index} failed: ${msg.message}`);
        }
        break;
      }
    }
  }

  #terminate() {
    for (const w of this.workers) w.terminate();
    this.workers = [];
  }

  #nextJobId() {
    this.#jobId = (this.#jobId + 1) | 0;
    return this.#jobId;
  }

  /** @param {JobHandle} handle @param {number} lane */
  #takeSlot(handle, lane) {
    const slot = this.#freeSlots.pop();
    if (slot === undefined) throw new Error(`job-slots-exhausted: ${JobQueue.SLOTS} jobs in flight (is every handle waited for?)`);
    handle.slot = slot;
    handle.lane = lane;
    return slot;
  }

  /**
   * Pushes a descriptor; while the lane is full, this thread helps drain it.
   * @param {number} lane @param {number} kernel @param {number} flags @param {ArrayLike<number>} args
   * @param {number} begin @param {number} end @param {number} grain @param {number} slotWord @param {number} job
   */
  #push(lane, kernel, flags, args, begin, end, grain, slotWord, job) {
    const queue = /** @type {JobQueue} */ (this.queue);
    while (!queue.push(lane, kernel, flags, args, begin, end, grain, slotWord, job)) {
      if (queue.pop(lane, this.#desc)) this.exec.execute(this.#desc);
    }
  }

  /**
   * Runs a job synchronously on this thread, slice by slice (`inline` tier; parallel-for in `transfer`).
   * @param {JobHandle} handle @param {number} kernel @param {ArrayLike<number>} args
   * @param {number} begin @param {number} end @param {number} grain @param {boolean} [once] one run even for an empty range
   */
  #runSlices(handle, kernel, args, begin, end, grain, once = false) {
    const k = this.registry.get(kernel);
    const a = this.#args;
    for (let i = 0; i < 6; i++) a[i] = args[i] | 0;
    try {
      if (once) k.run(this.ctx, a, begin, end);
      else for (let i = begin; i < end; i += grain) k.run(this.ctx, a, i, i + grain < end ? i + grain : end);
    } catch (err) {
      handle.error = err instanceof Error ? err.message : String(err);
      this.onJobError(handle.id, handle.key, err);
    }
  }

  /**
   * Yields until the word changes from `value` (or a time slice passes).
   * @param {Int32Array} i32 @param {number} index @param {number} value
   */
  static async #sleep(i32, index, value) {
    if (typeof Atomics.waitAsync === 'function') {
      const r = Atomics.waitAsync(i32, index, value, JobSystem.WAIT_SLICE_MS);
      if (r.async) await r.value;
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}
