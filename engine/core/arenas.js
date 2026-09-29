// @ts-check
// Allocators over heap regions (docs/engine/02-core-ecs-jobs.md#arenas-and-allocators).
// These are single-threaded: only the thread that owns an arena (usually the engine worker) allocates.
// Everything they return is a byte offset into the heap.

export class BumpArena {
  /** @param {{ off: number, size: number }} region */
  constructor(region) {
    this.start = region.off;
    this.end = region.off + region.size;
    this.top = region.off;
    this.highWater = 0;
  }

  /**
   * @param {number} bytes
   * @param {number} [align] power of two, at least 4
   * @returns {number} byte offset, or -1 when exhausted
   */
  alloc(bytes, align = 16) {
    const off = (this.top + align - 1) & ~(align - 1);
    if (off + bytes > this.end) return -1;
    this.top = off + bytes;
    this.highWater = Math.max(this.highWater, this.top - this.start);
    return off;
  }

  reset() {
    this.top = this.start;
  }

  get used() {
    return this.top - this.start;
  }
}

export class PoolArena {
  /**
   * Fixed-size blocks with a LIFO free list.
   * @param {{ off: number, size: number }} region
   * @param {number} blockBytes multiple of 64 (keeps blocks on cache-line boundaries)
   */
  constructor(region, blockBytes) {
    if (blockBytes % 64 !== 0) throw new Error('PoolArena blocks must be a multiple of 64 bytes');
    this.blockBytes = blockBytes;
    this.base = (region.off + 63) & ~63;
    this.capacity = Math.floor((region.off + region.size - this.base) / blockBytes);
    /** @type {number[]} free block indices, highest first so allocation starts at the lowest address */
    this.free = [];
    for (let i = this.capacity - 1; i >= 0; i--) this.free.push(i);
    this.inUse = 0;
    this.highWater = 0;
  }

  /** @returns {number} byte offset of a block, or -1 when exhausted */
  alloc() {
    const index = this.free.pop();
    if (index === undefined) return -1;
    this.inUse++;
    if (this.inUse > this.highWater) this.highWater = this.inUse;
    return this.base + index * this.blockBytes;
  }

  /** @param {number} off */
  release(off) {
    const index = (off - this.base) / this.blockBytes;
    if (DEV && (index < 0 || index >= this.capacity || index !== Math.floor(index))) throw new Error(`PoolArena.release: bad offset ${off}`);
    this.free.push(index);
    this.inUse--;
  }
}
