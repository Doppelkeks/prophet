// @ts-check
// Outbound blocks between the readback ring and the sim (docs/engine/05-gpu-swarm.md#k-latency-and-stalls).
// Harvest copies each tick's block out of the mapped readback slot into a pooled block; `take` hands it to
// the consumer. Nothing is allocated in steady state:
// - blocks come from a pool that grows only while more of them are outstanding than ever before;
// - a taken block goes back to the pool at the next `take`, so it stays valid until then.
// A copy moves the words before the event records and only the records present: most of a block's
// size is the event area, and most ticks have few events.
import { EVENT_WORDS, OH } from './swarm-layout.js';

export class BlockRing {
  /**
   * @param {import('./swarm-layout.js').SwarmLayout} layout
   * @param {number} capacity most blocks harvested and not taken yet at once (readback slots × ticks per slot)
   */
  constructor(layout, capacity) {
    const L = layout.L;
    this.words = L.outWords;
    this.eventsAt = L.oEvents;
    this.eventCap = L.eventCap;
    /** Ring positions, by tick: one more than the blocks that can be outstanding. */
    this.size = capacity + 1;
    this.ticks = new Int32Array(this.size).fill(-1);
    /** @type {(Int32Array | null)[]} */
    this.blocks = new Array(this.size).fill(null);
    /** @type {Int32Array[]} */
    this.free = [];
    /** @type {Int32Array | null} the block the last `take` returned */
    this.lent = null;
    /** Blocks harvested and not taken. */
    this.pending = 0;
    /** Blocks ever allocated (flat in steady state). */
    this.allocated = 0;
  }

  /**
   * Stores the block of `tick`, copied from `src` at word `at` (a mapped readback slot), and returns it.
   * Event records a reused block held beyond the new count are zeroed, so the block equals what the GPU
   * wrote (it clears O every tick).
   * @param {number} tick @param {Int32Array} src @param {number} at
   */
  put(tick, src, at) {
    const i = tick % this.size;
    if (this.ticks[i] !== -1) throw new Error(`swarm: block ring full at tick ${tick}: tick ${this.ticks[i]} was never taken`);
    let b = this.free.pop();
    if (!b) {
      b = new Int32Array(this.words);
      this.allocated++;
    }
    const cap = this.eventCap;
    const had = b[OH.EVENTS] < cap ? b[OH.EVENTS] : cap;
    const n = src[at + OH.EVENTS] < cap ? src[at + OH.EVENTS] : cap;
    const end = this.eventsAt + n * EVENT_WORDS;
    for (let w = 0; w < end; w++) b[w] = src[at + w];
    if (had > n) b.fill(0, end, this.eventsAt + had * EVENT_WORDS);
    this.ticks[i] = tick;
    this.blocks[i] = b;
    this.pending++;
    return b;
  }

  /**
   * The block of `tick`, or null if it has not arrived. It stays valid until the next `take`, which
   * returns it to the pool.
   * @param {number} tick
   */
  take(tick) {
    const i = tick % this.size;
    if (this.ticks[i] !== tick) return null;
    const b = /** @type {Int32Array} */ (this.blocks[i]);
    this.ticks[i] = -1;
    this.blocks[i] = null;
    this.pending--;
    if (this.lent) this.free.push(this.lent);
    this.lent = b;
    return b;
  }
}
