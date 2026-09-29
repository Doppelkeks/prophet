// @ts-check
// The input ring (docs/engine/07-ui.md#input): raw input records from the main thread to the engine
// worker, single producer / single consumer. In the `shared` tier it lives in the jobs arena of the
// heap; in the `transfer` tier the engine owns a private ring and fills it from `input` messages, so
// the consumer side is the same code in both tiers.
//
// Layout (i32 words from the base): 0 head (consumer), 16 tail (producer), 32 dropped records,
// 48.. records of 4 words: [kind, a, b, c]. Head and tail are only touched through Atomics; a slot
// is written before the tail that publishes it, and read before the head that frees it.

/** Record kinds and their payloads. */
export const InputKind = Object.freeze({
  KEY: 1, // a = key code (InputCodes), b = 1 down / 0 up
  POINTER: 2, // a = x, b = y (device pixels in the canvas), c = buttons bitmask
  BUTTON: 3, // a = button, b = 1 down / 0 up
  WHEEL: 4, // a = delta y (device pixels, rounded)
  GAMEPAD: 5, // a = left stick (x i16 | y i16 << 16), b = right stick, c = buttons bitmask
  BLUR: 6, // focus lost: release everything
});

const HEAD = 0;
const TAIL = 16;
const DROPPED = 32;
const DATA = 48;
const RECORD = 4;

export class InputRing {
  static CAPACITY = 1024;

  /** Bytes for a ring of `capacity` records (a power of two). @param {number} [capacity] */
  static bytes(capacity = InputRing.CAPACITY) {
    return (DATA + capacity * RECORD) * 4;
  }

  /**
   * @param {Int32Array} i32 view over the (shared or private) buffer
   * @param {number} baseW word index of the ring
   * @param {number} [capacity] records, a power of two
   */
  constructor(i32, baseW, capacity = InputRing.CAPACITY) {
    if (capacity & (capacity - 1)) throw new Error('InputRing capacity must be a power of two');
    this.i32 = i32;
    this.base = baseW;
    this.capacity = capacity;
    this.mask = capacity - 1;
  }

  /** A private ring in its own buffer (transfer tier, tests). @param {number} [capacity] */
  static create(capacity = InputRing.CAPACITY) {
    return new InputRing(new Int32Array(InputRing.bytes(capacity) >> 2), 0, capacity);
  }

  /** Clears the ring. Call before the producer starts. */
  format() {
    this.i32.fill(0, this.base, this.base + DATA + this.capacity * RECORD);
  }

  /**
   * Producer: appends a record; returns false (and counts it) when the ring is full.
   * @param {number} kind @param {number} a @param {number} [b] @param {number} [c]
   */
  push(kind, a, b = 0, c = 0) {
    const i32 = this.i32;
    const tail = Atomics.load(i32, this.base + TAIL);
    if (((tail - Atomics.load(i32, this.base + HEAD)) | 0) >= this.capacity) {
      Atomics.add(i32, this.base + DROPPED, 1);
      return false;
    }
    const at = this.base + DATA + (tail & this.mask) * RECORD;
    i32[at] = kind;
    i32[at + 1] = a;
    i32[at + 2] = b;
    i32[at + 3] = c;
    Atomics.store(i32, this.base + TAIL, (tail + 1) | 0);
    return true;
  }

  /**
   * Consumer: hands every pending record to `fn`, oldest first.
   * @param {(kind: number, a: number, b: number, c: number) => void} fn
   * @returns {number} records drained
   */
  drain(fn) {
    const i32 = this.i32;
    let head = Atomics.load(i32, this.base + HEAD);
    const tail = Atomics.load(i32, this.base + TAIL);
    let n = 0;
    while (head !== tail) {
      const at = this.base + DATA + (head & this.mask) * RECORD;
      fn(i32[at], i32[at + 1], i32[at + 2], i32[at + 3]);
      head = (head + 1) | 0;
      Atomics.store(i32, this.base + HEAD, head);
      n++;
    }
    return n;
  }

  /** Records lost because the ring was full. */
  get dropped() {
    return Atomics.load(this.i32, this.base + DROPPED);
  }

  /** Records waiting. */
  get pending() {
    return (Atomics.load(this.i32, this.base + TAIL) - Atomics.load(this.i32, this.base + HEAD)) | 0;
  }
}
