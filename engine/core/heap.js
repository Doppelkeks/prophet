// @ts-check
// The fixed-size engine heap (ADR-009, docs/engine/02-core-ecs-jobs.md#memory-heap-and-arenas).
// One WebAssembly.Memory with initial = maximum, shared when the page is cross-origin isolated.
// It is never grown: views stay valid for the whole run on every thread.

const MB = 1024 * 1024;

/** @typedef {'high' | 'std' | 'test'} HeapProfile */
/** @typedef {{ name: string, off: number, size: number }} ArenaRegion */

export class Heap {
  static PAGE = 65536;
  static HEADER_BYTES = 65536;
  static MAGIC = 0x50524f50; // 'PROP'
  static VERSION = 1;

  /** Word indices in the header. Words written by different threads sit on separate 64-byte lines. */
  static W = Object.freeze({
    MAGIC: 0,
    VERSION: 1,
    MANIFEST: 2,
    BYTES: 3,
    ARENA_COUNT: 4,
    EPOCH: 16,
    TICK: 32,
    PING: 48,
    ARENAS: 256,
  });

  static ARENA_NAMES = /** @type {const} */ (['ecs', 'voxel', 'nav', 'jobs', 'pcg', 'assets', 'reserve']);

  /** Arena sizes in bytes per profile (docs/BUDGETS.md#shared-heap); the reserve takes the rest. */
  static PROFILES = {
    high: { total: 320 * MB, ecs: 48 * MB, voxel: 80 * MB, nav: 8 * MB, jobs: 16 * MB, pcg: 64 * MB, assets: 48 * MB },
    std: { total: 320 * MB, ecs: 48 * MB, voxel: 80 * MB, nav: 8 * MB, jobs: 16 * MB, pcg: 64 * MB, assets: 48 * MB },
    test: { total: 32 * MB, ecs: 8 * MB, voxel: 1 * MB, nav: 1 * MB, jobs: 2 * MB, pcg: 1 * MB, assets: 1 * MB },
  };

  /**
   * @param {ArrayBuffer | SharedArrayBuffer} buffer
   * @param {WebAssembly.Memory | null} memory
   */
  constructor(buffer, memory = null) {
    this.buffer = buffer;
    this.memory = memory;
    this.shared = typeof SharedArrayBuffer === 'function' && buffer instanceof SharedArrayBuffer;
    this.u8 = new Uint8Array(buffer);
    this.u16 = new Uint16Array(buffer);
    this.i32 = new Int32Array(buffer);
    this.u32 = new Uint32Array(buffer);
    this.f32 = new Float32Array(buffer);
    /** @type {Map<string, ArenaRegion>} */
    this.arenas = new Map();
  }

  /**
   * Arena table of a profile: contiguous 64-byte-aligned regions after the header; the reserve takes the rest.
   * @param {HeapProfile} profile
   * @returns {{ total: number, arenas: ArenaRegion[] }}
   */
  static layout(profile) {
    const p = /** @type {{ total: number } & Record<string, number>} */ (Heap.PROFILES[profile]);
    if (!p) throw new Error(`unknown heap profile ${profile}`);
    if (p.total % Heap.PAGE !== 0) throw new Error(`heap profile ${profile} is not a whole number of pages`);
    /** @type {ArenaRegion[]} */
    const arenas = [];
    let off = Heap.HEADER_BYTES;
    for (const name of Heap.ARENA_NAMES) {
      const size = name === 'reserve' ? p.total - off : p[name];
      if (!(size >= 0) || off + size > p.total || size % 64 !== 0) throw new Error(`heap profile ${profile} is invalid at arena ${name}`);
      arenas.push({ name, off, size });
      off += size;
    }
    return { total: p.total, arenas };
  }

  /**
   * Creates and formats a heap for a profile.
   * @param {HeapProfile} profile
   * @param {boolean} shared requires cross-origin isolation in browsers
   */
  static create(profile, shared) {
    const { total, arenas } = Heap.layout(profile);
    const pages = total / Heap.PAGE;
    const memory = new WebAssembly.Memory({ initial: pages, maximum: pages, shared });
    const heap = new Heap(memory.buffer, memory);
    heap.#format(total, arenas);
    return heap;
  }

  /** Attaches to a heap formatted on another thread (workers receive `heap.buffer`). @param {ArrayBuffer | SharedArrayBuffer} buffer */
  static attach(buffer) {
    const heap = new Heap(buffer);
    const W = Heap.W;
    if (heap.i32[W.MAGIC] !== Heap.MAGIC) throw new Error('heap-attach: bad magic (not a formatted Prophet heap)');
    if (heap.i32[W.VERSION] !== Heap.VERSION) throw new Error('heap-attach: layout version mismatch');
    const count = heap.i32[W.ARENA_COUNT];
    for (let i = 0; i < count; i++) {
      const base = W.ARENAS + i * 4;
      const name = Heap.ARENA_NAMES[heap.i32[base]];
      heap.arenas.set(name, { name, off: heap.i32[base + 1], size: heap.i32[base + 2] });
    }
    return heap;
  }

  /** Wraps a plain buffer without an arena table (transfer-tier job buffers). @param {ArrayBuffer} buffer */
  static wrap(buffer) {
    return new Heap(buffer);
  }

  /** @param {number} total @param {ArenaRegion[]} arenas */
  #format(total, arenas) {
    const W = Heap.W;
    for (let i = 0; i < arenas.length; i++) {
      const a = arenas[i];
      this.arenas.set(a.name, a);
      const base = W.ARENAS + i * 4;
      this.i32[base] = Heap.ARENA_NAMES.indexOf(/** @type {any} */ (a.name));
      this.i32[base + 1] = a.off;
      this.i32[base + 2] = a.size;
    }
    this.i32[W.ARENA_COUNT] = arenas.length;
    this.i32[W.BYTES] = total | 0;
    this.i32[W.VERSION] = Heap.VERSION;
    Atomics.store(this.i32, W.MAGIC, Heap.MAGIC); // last: attach() checks it first
  }

  /** @param {string} name @returns {ArenaRegion} */
  arena(name) {
    const a = this.arenas.get(name);
    if (!a) throw new Error(`unknown arena ${name}`);
    return a;
  }

  /** Byte length of the heap. */
  get bytes() {
    return this.buffer.byteLength;
  }
}
