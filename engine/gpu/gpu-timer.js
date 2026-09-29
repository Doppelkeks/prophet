// @ts-check
// GPU pass timings with `timestamp-query` (docs/engine/03-rendering.md#profiling). A pass writes timestamp
// pair i at its start and end; the frame resolves the pairs it used and copies them into its readback slot,
// so timings come back with the blocks, in order, and never stall. Browsers may quantize timestamps: read
// averages and percentiles over many frames, never one sample.

/** Bytes per resolved pair: two u64 timestamps in ns. */
export const PAIR_BYTES = 16;

export class GpuTimer {
  /** @param {GPUDevice} device */
  static supported(device) {
    return device.features.has('timestamp-query');
  }

  /**
   * @param {GPUDevice} device
   * @param {number} pairs timestamp pairs one frame can write
   * @param {string} [label]
   */
  constructor(device, pairs, label = 'timer') {
    this.pairs = pairs;
    this.bytes = pairs * PAIR_BYTES;
    this.querySet = device.createQuerySet({ type: 'timestamp', count: pairs * 2, label: `${label}.queries` });
    this.resolved = device.createBuffer({ size: this.bytes, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC, label: `${label}.resolved` });
    /** @type {GPUComputePassTimestampWrites[]} */
    this.writes = [];
    for (let i = 0; i < pairs; i++) this.writes.push({ querySet: this.querySet, beginningOfPassWriteIndex: 2 * i, endOfPassWriteIndex: 2 * i + 1 });
  }

  /**
   * Resolves the first `n` pairs and copies them to `dst` at `offset`. The resolve buffer is reused by every
   * frame: the queue orders each frame's resolve and copy after its passes and before the next frame's.
   * @param {GPUCommandEncoder} encoder @param {number} n @param {GPUBuffer} dst @param {number} offset
   */
  resolve(encoder, n, dst, offset) {
    if (n <= 0) return;
    encoder.resolveQuerySet(this.querySet, 0, 2 * n, this.resolved, 0);
    encoder.copyBufferToBuffer(this.resolved, 0, dst, offset, n * PAIR_BYTES);
  }

  /**
   * Duration of pair `i` in ns, read from resolved pairs as 32-bit words starting at word `at` (u64
   * little-endian: begin lo, begin hi, end lo, end hi). No BigInt, so nothing is allocated. Returns 0 when
   * the timestamps are unusable (a reset or quantized clock can make end ≤ begin).
   * @param {Int32Array} words @param {number} at @param {number} i
   */
  static ns(words, at, i) {
    const b = at + 4 * i;
    const d = ((words[b + 3] >>> 0) - (words[b + 1] >>> 0)) * 4294967296 + ((words[b + 2] >>> 0) - (words[b] >>> 0));
    return d > 0 ? d : 0;
  }

  destroy() {
    this.querySet.destroy();
    this.resolved.destroy();
  }
}

/** A ring of recent samples with percentiles (ms). `percentile` sorts a preallocated copy: no allocation. */
export class Samples {
  /** @param {number} [size] */
  constructor(size = 256) {
    this.values = new Float64Array(size);
    this.sorted = new Float64Array(size);
    this.count = 0;
  }

  /** @param {number} v */
  push(v) {
    this.values[this.count++ % this.values.length] = v;
  }

  /** @param {number} q in [0, 1] */
  percentile(q) {
    const n = Math.min(this.count, this.values.length);
    if (!n) return 0;
    const sorted = this.sorted;
    sorted.set(this.values);
    if (n < sorted.length) sorted.fill(Infinity, n); // unused entries sort last
    sorted.sort();
    return sorted[Math.min(n - 1, Math.floor(n * q))];
  }

  reset() {
    this.count = 0;
  }
}
