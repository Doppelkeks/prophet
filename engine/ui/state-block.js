// @ts-check
// The UI state block (docs/engine/07-ui.md#state-bridge): a fixed-layout struct the engine writes and
// the main thread reads, protected by a seqlock. Every word, `seq` and fields alike, goes through
// Atomics: sequentially consistent accesses can't be reordered around the `seq` accesses, while plain
// typed-array accesses to shared memory give no such guarantee.
// In the `transfer` tier the engine posts a copy of the block and the reader wraps a private buffer;
// the reader API is the same.

/** @typedef {'i32' | 'u32' | 'f32'} StateFieldType */

/** Word 0 is `seq`; fields follow in declaration order, one word each. */
export class StateSchema {
  static MAX_WORDS = 1024; // 4 KiB (docs/BUDGETS.md#ui-constants)

  /** @param {Record<string, StateFieldType>} fields */
  constructor(fields) {
    /** @type {Record<string, number>} word index per field */
    this.index = {};
    /** @type {StateFieldType[]} type per word (word 0: seq) */
    this.types = ['u32'];
    for (const [name, type] of Object.entries(fields)) {
      this.index[name] = this.types.length;
      this.types.push(type);
    }
    this.words = this.types.length;
    if (this.words > StateSchema.MAX_WORDS) throw new Error('state block larger than 4 KiB');
  }

  get bytes() {
    return this.words * 4;
  }
}

const f32 = new Float32Array(1);
const bits = new Int32Array(f32.buffer);

/** Engine side. */
export class StateBlockWriter {
  /** @param {Int32Array} i32 @param {number} baseW @param {StateSchema} schema */
  constructor(i32, baseW, schema) {
    this.i32 = i32;
    this.base = baseW;
    this.schema = schema;
    this.open = false;
  }

  /** Starts an update: `seq` becomes odd. */
  begin() {
    Atomics.add(this.i32, this.base, 1);
    this.open = true;
  }

  /** @param {number} index word index from `schema.index` @param {number} value */
  set(index, value) {
    if (this.schema.types[index] === 'f32') {
      f32[0] = value;
      Atomics.store(this.i32, this.base + index, bits[0]);
    } else {
      Atomics.store(this.i32, this.base + index, value);
    }
  }

  /** Publishes the update: `seq` becomes even. */
  end() {
    Atomics.add(this.i32, this.base, 1);
    this.open = false;
  }

  /** A copy of the block (transfer tier: posted to the main thread). */
  copy() {
    return this.i32.slice(this.base, this.base + this.schema.words);
  }
}

/** Main-thread side. */
export class StateBlockReader {
  /** @param {Int32Array} i32 @param {number} baseW @param {StateSchema} schema */
  constructor(i32, baseW, schema) {
    this.i32 = i32;
    this.base = baseW;
    this.schema = schema;
    /** The last good snapshot. */
    this.snap = new Int32Array(schema.words);
    /** Attempts copy here and swap with `snap` only when they succeed, so a failed attempt never tears it. */
    this.scratch = new Int32Array(schema.words);
    this.ok = false;
    this.retries = 0;
  }

  /** A private block fed by posted copies (transfer tier). @param {StateSchema} schema */
  static detached(schema) {
    return new StateBlockReader(new Int32Array(schema.words), 0, schema);
  }

  /** Transfer tier: stores a posted copy. @param {Int32Array} words */
  receive(words) {
    this.i32.set(words.subarray(0, this.schema.words), this.base);
  }

  /**
   * A torn-free snapshot: up to three attempts, then the last good one.
   * @returns {Int32Array | null} null until the first good snapshot
   */
  read() {
    const i32 = this.i32;
    const b = this.base;
    const n = this.schema.words;
    const scratch = this.scratch;
    for (let attempt = 0; attempt < 3; attempt++) {
      const s1 = Atomics.load(i32, b);
      if (s1 & 1) {
        this.retries++;
        continue;
      }
      for (let w = 1; w < n; w++) scratch[w] = Atomics.load(i32, b + w);
      if (Atomics.load(i32, b) === s1) {
        scratch[0] = s1;
        this.scratch = this.snap;
        this.snap = scratch;
        this.ok = true;
        return scratch;
      }
      this.retries++;
    }
    return this.ok ? this.snap : null;
  }

  /** A field of the last snapshot, decoded by type. @param {number} index */
  get(index) {
    const t = this.schema.types[index];
    if (t === 'f32') {
      bits[0] = this.snap[index];
      return f32[0];
    }
    return t === 'u32' ? this.snap[index] >>> 0 : this.snap[index];
  }
}
