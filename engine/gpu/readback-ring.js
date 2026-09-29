// @ts-check
// The readback ring (docs/engine/03-rendering.md#readback-ring): MAP_READ slots the frame copies its
// outbound blocks into. Slots are mapped after submit and harvested strictly in submission order, so
// block T never overtakes block T − 1. It needs at least K + 1 slots: one being written plus up to K
// in flight. Latency from submit to harvest is sampled for the readback budget.
// Harvesting copies nothing: the consumer reads the mapped range in place, and the slot is unmapped right
// after. Slots keep their tick lists and map callbacks, so a frame allocates only the map's promise.
import { Samples } from './gpu-timer.js';

/**
 * @typedef {object} ReadbackSlot
 * @property {GPUBuffer} buffer
 * @property {'free' | 'encoding' | 'mapping' | 'ready'} state
 * @property {number[]} ticks the ticks whose blocks the slot holds, in order (cleared by acquire)
 * @property {number} submittedAt
 * @property {number} seq
 * @property {() => void} onMapped
 * @property {(err: unknown) => void} onMapFailed
 */

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
      /** @type {ReadbackSlot} */
      const slot = { buffer, state: 'free', ticks: [], submittedAt: 0, seq: 0, onMapped: () => {}, onMapFailed: () => {} };
      slot.onMapped = () => {
        slot.state = 'ready';
      };
      slot.onMapFailed = (err) => {
        this.lost = true; // device lost or buffer destroyed
        this.lostReason = String(err);
      };
      this.slots.push(slot);
    }
    /** @type {ReadbackSlot[]} submitted, oldest first */
    this.inFlight = [];
    this.seq = 0;
    /** Frames that found no free slot. */
    this.starved = 0;
    /** Submit → harvest latencies, in ms. */
    this.latency = new Samples(256);
    this.lost = false;
    this.lostReason = '';
  }

  /** A free slot for this frame's copies, or null when all are in flight. */
  acquire() {
    const slots = this.slots;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (slot.state !== 'free') continue;
      slot.state = 'encoding';
      slot.ticks.length = 0;
      return slot;
    }
    this.starved++;
    return null;
  }

  /** The frame was submitted without copying anything into the slot. @param {ReadbackSlot} slot */
  release(slot) {
    slot.state = 'free';
  }

  /**
   * The frame holding the slot's copies was submitted: map it. `ticks` lists the blocks it holds; pass
   * `slot.ticks` itself when the frame filled it.
   * @param {ReadbackSlot} slot @param {number[]} ticks
   */
  submitted(slot, ticks) {
    if (ticks !== slot.ticks) {
      slot.ticks.length = 0;
      for (let i = 0; i < ticks.length; i++) slot.ticks.push(ticks[i]);
    }
    slot.state = 'mapping';
    slot.submittedAt = performance.now();
    slot.seq = this.seq++;
    this.inFlight.push(slot);
    slot.buffer.mapAsync(GPUMapMode.READ).then(slot.onMapped, slot.onMapFailed);
  }

  /**
   * Hands every ready slot at the head of the queue to `fn`, in submission order, then unmaps it. `data`
   * is the mapped range itself, not a copy: it is detached once `fn` returns, so read it right there.
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
        data = slot.buffer.getMappedRange();
      } catch (err) {
        // A device loss unmaps every buffer, possibly after the map resolved and before device.lost
        // does: the ring is dead, and the engine's recovery replaces it.
        this.lost = true;
        this.lostReason = String(err);
        return n;
      }
      try {
        fn(slot, data);
      } finally {
        slot.buffer.unmap();
        slot.state = 'free';
      }
      this.latency.push(performance.now() - slot.submittedAt);
      n++;
    }
    return n;
  }

  /** 95th percentile of the recent submit → harvest latencies, in ms. */
  p95() {
    return this.latency.percentile(0.95);
  }

  /** 99th percentile of the recent submit → harvest latencies, in ms (the M1 rule counts it in ticks). */
  p99() {
    return this.latency.percentile(0.99);
  }

  destroy() {
    for (const s of this.slots) s.buffer.destroy();
  }
}
