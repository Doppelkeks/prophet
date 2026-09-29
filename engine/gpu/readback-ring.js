// @ts-check
// The readback ring (docs/engine/03-rendering.md#readback-ring): MAP_READ slots the frame copies its
// outbound blocks into. Slots are mapped after submit and harvested strictly in submission order, so
// block T never overtakes block T − 1. It needs at least K + 1 slots: one being written plus up to K
// in flight. Latency from submit to harvest is sampled for the readback budget.

/** @typedef {{ buffer: GPUBuffer, state: 'free' | 'encoding' | 'mapping' | 'ready', ticks: number[], submittedAt: number, seq: number }} ReadbackSlot */

export class ReadbackRing {
  /**
   * @param {GPUDevice} device
   * @param {{ slots: number, bytes: number, label?: string }} o
   */
  constructor(device, o) {
    this.device = device;
    this.bytes = o.bytes;
    /** @type {ReadbackSlot[]} */
    this.slots = [];
    for (let i = 0; i < o.slots; i++) {
      const buffer = device.createBuffer({ size: o.bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST, label: `${o.label ?? 'readback'}.${i}` });
      this.slots.push({ buffer, state: 'free', ticks: [], submittedAt: 0, seq: 0 });
    }
    /** @type {ReadbackSlot[]} submitted, oldest first */
    this.inFlight = [];
    this.seq = 0;
    /** Frames that found no free slot. */
    this.starved = 0;
    this.samples = new Float64Array(128);
    this.sampleCount = 0;
    this.lost = false;
    this.lostReason = '';
  }

  /** A free slot for this frame's copies, or null when all are in flight. */
  acquire() {
    const slot = this.slots.find((s) => s.state === 'free');
    if (!slot) {
      this.starved++;
      return null;
    }
    slot.state = 'encoding';
    slot.ticks = [];
    return slot;
  }

  /** The frame was submitted without copying anything into the slot. @param {ReadbackSlot} slot */
  release(slot) {
    slot.state = 'free';
  }

  /** The frame holding the slot's copies was submitted: map it. @param {ReadbackSlot} slot @param {number[]} ticks */
  submitted(slot, ticks) {
    slot.state = 'mapping';
    slot.ticks = ticks;
    slot.submittedAt = performance.now();
    slot.seq = this.seq++;
    this.inFlight.push(slot);
    slot.buffer.mapAsync(GPUMapMode.READ).then(
      () => {
        slot.state = 'ready';
      },
      (err) => {
        this.lost = true; // device lost or buffer destroyed
        this.lostReason = String(err);
      },
    );
  }

  /**
   * Hands every ready slot at the head of the queue to `fn`, in submission order, then unmaps it.
   * @param {(slot: ReadbackSlot, data: ArrayBuffer) => void} fn
   * @returns {number} slots harvested
   */
  harvest(fn) {
    let n = 0;
    while (!this.lost && this.inFlight.length && this.inFlight[0].state === 'ready') {
      const slot = /** @type {ReadbackSlot} */ (this.inFlight.shift());
      /** @type {ArrayBuffer} */
      let data;
      try {
        data = slot.buffer.getMappedRange().slice(0);
      } catch (err) {
        // A device loss unmaps every buffer, possibly after the map resolved and before device.lost
        // does: the ring is dead, and the engine's recovery replaces it.
        this.lost = true;
        this.lostReason = String(err);
        return n;
      }
      fn(slot, data);
      slot.buffer.unmap();
      slot.state = 'free';
      this.samples[this.sampleCount++ % this.samples.length] = performance.now() - slot.submittedAt;
      n++;
    }
    return n;
  }

  /** 95th percentile of the recent submit → harvest latencies, in ms. */
  p95() {
    const n = Math.min(this.sampleCount, this.samples.length);
    if (!n) return 0;
    const sorted = Array.from(this.samples.subarray(0, n)).sort((a, b) => a - b);
    return sorted[Math.min(n - 1, Math.floor(n * 0.95))];
  }

  destroy() {
    for (const s of this.slots) s.buffer.destroy();
  }
}
