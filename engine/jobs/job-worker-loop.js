// @ts-check
// The job-worker side of the job system. This is the ONLY place allowed to call Atomics.wait
// (tools/lint-sim.js enforces it): job workers may block, the engine and main threads never do.
import { Heap } from '../core/heap.js';
import { JobQueue } from './job-queue.js';
import { JobExecutor } from './job-executor.js';

/**
 * Messages from the engine:
 * - `init` { mode, index, manifest, buffer?, jobs?, waitMs? }: check the kernel manifest, then serve jobs
 *   (`shared`: block in the queue loop until the stop flag is set; `transfer`: wait for `run` messages)
 * - `run` { id, kernel, args, begin, end, buffer }: one transfer-tier job
 *
 * Messages to the engine: `ready`, `stopped`, `done` { id, buffer, error? }, `job-error` { job, key, message },
 * and `error` { message } when the worker cannot serve at all (for example `manifest-mismatch`).
 */
export class JobWorkerLoop {
  /**
   * @param {import('./worker-port.js').WorkerPort} port
   * @param {import('./kernel.js').KernelRegistry} registry
   */
  constructor(port, registry) {
    this.port = port;
    this.registry = registry;
    this.index = -1;
  }

  listen() {
    this.port.listen((msg) => this.onMessage(msg));
  }

  /** @param {any} msg */
  onMessage(msg) {
    try {
      if (msg.type === 'init') this.init(msg);
      else if (msg.type === 'run') this.runTransfer(msg);
    } catch (err) {
      this.port.post({ type: 'error', message: JobWorkerLoop.message(err), index: this.index });
    }
  }

  /** @param {{ mode: 'shared' | 'transfer', index: number, manifest: number, buffer?: SharedArrayBuffer, jobs?: { off: number, size: number }, waitMs?: number }} msg */
  init(msg) {
    this.index = msg.index;
    if (msg.manifest >>> 0 !== this.registry.hash) {
      throw new Error(
        `manifest-mismatch: job worker ${msg.index} has kernel manifest 0x${this.registry.hash.toString(16)}, the engine expects 0x${(msg.manifest >>> 0).toString(16)}`,
      );
    }
    if (msg.mode === 'transfer') {
      this.port.post({ type: 'ready', index: this.index });
      return;
    }
    if (!msg.buffer || !msg.jobs) throw new Error('shared mode needs the heap buffer and the jobs region');
    const heap = Heap.attach(msg.buffer);
    const queue = new JobQueue(heap, msg.jobs);
    Atomics.add(heap.i32, queue.readyW, 1);
    this.port.post({ type: 'ready', index: this.index });
    this.loop(heap, queue, msg.waitMs ?? 50); // blocks this worker until the stop flag is set
    this.port.post({ type: 'stopped', index: this.index });
  }

  /**
   * @param {Heap} heap
   * @param {JobQueue} queue
   * @param {number} waitMs sleep timeout; only a safety net, since producers always notify
   */
  loop(heap, queue, waitMs) {
    const i32 = heap.i32;
    const onError = (/** @type {number} */ job, /** @type {string} */ key, /** @type {unknown} */ err) =>
      this.port.post({ type: 'job-error', job, key, message: JobWorkerLoop.message(err), index: this.index });
    const exec = new JobExecutor({ heap, worker: this.index }, this.registry, onError);
    const desc = new Int32Array(16);
    while (Atomics.load(i32, queue.stopW) === 0) {
      // Read the wake word BEFORE trying to pop: a push that lands in between changes it,
      // so the wait below returns at once instead of sleeping through the new job.
      const wake = Atomics.load(i32, queue.wakeW);
      if (queue.pop(JobQueue.CRIT, desc) || queue.pop(JobQueue.BG, desc)) {
        exec.execute(desc);
        continue;
      }
      Atomics.wait(i32, queue.wakeW, wake, waitMs);
    }
  }

  /**
   * Transfer tier: runs one job on a transferred buffer and sends the buffer back, also on failure,
   * so the engine's buffer pool never leaks.
   * @param {{ id: number, kernel: number, args: number[], begin: number, end: number, buffer: ArrayBuffer }} msg
   */
  runTransfer(msg) {
    let error = '';
    try {
      const heap = Heap.wrap(msg.buffer);
      this.registry.get(msg.kernel).run({ heap, worker: this.index }, Int32Array.from(msg.args), msg.begin, msg.end);
    } catch (err) {
      error = JobWorkerLoop.message(err);
    }
    this.port.post({ type: 'done', id: msg.id, buffer: msg.buffer, error }, [msg.buffer]);
  }

  /** @param {unknown} err */
  static message(err) {
    return err instanceof Error ? err.message : String(err);
  }
}
