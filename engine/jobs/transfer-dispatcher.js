// @ts-check
// The `transfer` threading tier (docs/engine/02-core-ecs-jobs.md#threading-tiers). The heap is private to
// the engine worker, so each async job's regions are packed into a pooled, transferable ArrayBuffer with
// the region arguments rebased. The job worker runs the same kernel over that buffer and transfers it
// back; the regions the job may write are then copied into the heap. The heap's own buffer belongs to the
// WebAssembly.Memory and can't be transferred.

/**
 * One heap region a job touches: `args[arg]` holds its byte offset in the heap.
 * Every region is copied to the worker, so the kernel sees exactly the heap's bytes; `write` and
 * `readwrite` regions are copied back when the job returns.
 * @typedef {{ arg: number, bytes: number, access: 'read' | 'write' | 'readwrite' }} JobRegion
 */

/** @typedef {{ resolve: () => void, reject: (err: Error) => void, regions: JobRegion[], heapOffs: number[], packedOffs: number[], worker: number, key: string }} PendingTransfer */

export class TransferDispatcher {
  static ALIGN = 64;
  static MIN_BUFFER = 65536;

  /**
   * @param {import('../core/heap.js').Heap} heap
   * @param {import('./worker-port.js').WorkerHandle[]} workers already initialized in `transfer` mode
   */
  constructor(heap, workers) {
    this.heap = heap;
    this.workers = workers;
    this.inFlight = new Int32Array(workers.length);
    /** @type {Map<number, PendingTransfer>} */
    this.pending = new Map();
    /** @type {Map<number, ArrayBuffer[]>} free buffers by size (powers of two) */
    this.pool = new Map();
    this.buffersCreated = 0;
  }

  /**
   * Starts one job on the least busy worker.
   * @param {number} id job id
   * @param {number} kernel kernel id
   * @param {string} key kernel key (for errors)
   * @param {ArrayLike<number>} args
   * @param {number} begin
   * @param {number} end
   * @param {JobRegion[]} regions
   * @returns {Promise<void>}
   */
  run(id, kernel, key, args, begin, end, regions) {
    const packedArgs = Array.from({ length: 6 }, (_, a) => args[a] | 0);
    /** @type {number[]} */
    const heapOffs = [];
    /** @type {number[]} */
    const packedOffs = [];
    let total = 0;
    for (const r of regions) {
      if (r.arg < 0 || r.arg > 5 || r.bytes < 0) throw new Error(`bad job region ${JSON.stringify(r)}`);
      const off = args[r.arg];
      if (off < 0 || off + r.bytes > this.heap.bytes) throw new Error(`job region outside the heap: ${JSON.stringify(r)}`);
      heapOffs.push(off);
      packedOffs.push(total);
      packedArgs[r.arg] = total;
      total += Math.ceil(r.bytes / TransferDispatcher.ALIGN) * TransferDispatcher.ALIGN;
    }
    const buffer = this.#take(total);
    const u8 = new Uint8Array(buffer);
    for (let r = 0; r < regions.length; r++) {
      u8.set(this.heap.u8.subarray(heapOffs[r], heapOffs[r] + regions[r].bytes), packedOffs[r]);
    }
    let worker = 0;
    for (let w = 1; w < this.workers.length; w++) if (this.inFlight[w] < this.inFlight[worker]) worker = w;
    this.inFlight[worker]++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, regions, heapOffs, packedOffs, worker, key });
      this.workers[worker].post({ type: 'run', id, kernel, args: packedArgs, begin, end, buffer }, [buffer]);
    });
  }

  /** Handles a worker's `done` message. @param {{ id: number, buffer: ArrayBuffer, error?: string }} msg */
  onDone(msg) {
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    this.inFlight[p.worker]--;
    if (!msg.error) {
      const u8 = new Uint8Array(msg.buffer);
      for (let r = 0; r < p.regions.length; r++) {
        const region = p.regions[r];
        if (region.access === 'read') continue;
        this.heap.u8.set(u8.subarray(p.packedOffs[r], p.packedOffs[r] + region.bytes), p.heapOffs[r]);
      }
    }
    this.#give(msg.buffer);
    if (msg.error) p.reject(new Error(`job-failed: job ${msg.id} (${p.key}): ${msg.error}`));
    else p.resolve();
  }

  /** Fails every job still in flight (a worker died or the system shuts down). @param {string} reason */
  failAll(reason) {
    for (const [id, p] of this.pending) p.reject(new Error(`job-failed: job ${id} (${p.key}): ${reason}`));
    this.pending.clear();
    this.inFlight.fill(0);
  }

  /** @param {number} bytes */
  #take(bytes) {
    let size = TransferDispatcher.MIN_BUFFER;
    while (size < bytes) size *= 2;
    const free = this.pool.get(size);
    if (free && free.length) return /** @type {ArrayBuffer} */ (free.pop());
    this.buffersCreated++;
    return new ArrayBuffer(size);
  }

  /** @param {ArrayBuffer} buffer */
  #give(buffer) {
    const list = this.pool.get(buffer.byteLength);
    if (list) list.push(buffer);
    else this.pool.set(buffer.byteLength, [buffer]);
  }
}
