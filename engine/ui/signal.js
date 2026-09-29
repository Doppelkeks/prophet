// @ts-check
// Signals (docs/engine/07-ui.md#signals): `Signal` holds a value, `Computed` derives one lazily, and
// `effect` re-runs a side effect when what it read changes. Effects are queued and run by
// `Signals.flush()`, which the main host calls once per animation frame, so every binding runs at most
// once per frame, and only when a value it read actually changed.

/** @typedef {{ markDirty(): void, dependencies: Set<Source> }} Observer */
/** @typedef {Signal<any> | Computed<any>} Source */

/** @type {Observer | null} */
let current = null;
/** @type {Set<Effect>} */
const queue = new Set();

/**
 * @param {Source} source
 * @param {Set<Observer>} observers
 */
function track(source, observers) {
  if (!current) return;
  observers.add(current);
  current.dependencies.add(source);
}

/** @template T */
export class Signal {
  /** @param {T} value @param {(a: T, b: T) => boolean} [equals] */
  constructor(value, equals = Object.is) {
    this.#value = value;
    this.equals = equals;
  }

  #value;
  /** @type {Set<Observer>} */
  observers = new Set();

  get value() {
    track(this, this.observers);
    return this.#value;
  }

  set value(v) {
    if (this.equals(this.#value, v)) return;
    this.#value = v;
    for (const o of [...this.observers]) o.markDirty();
  }

  /** Reads without subscribing. */
  peek() {
    return this.#value;
  }

  /** Equality for numbers that ignores changes smaller than `epsilon`. @param {number} epsilon */
  static near(epsilon) {
    return (/** @type {number} */ a, /** @type {number} */ b) => Math.abs(a - b) < epsilon;
  }
}

/** @template T */
export class Computed {
  /** @param {() => T} fn @param {(a: T, b: T) => boolean} [equals] */
  constructor(fn, equals = Object.is) {
    this.fn = fn;
    this.equals = equals;
    this.dirty = true;
    /** @type {T | undefined} */
    this.cached = undefined;
    /** @type {Set<Source>} */
    this.dependencies = new Set();
    /** @type {Set<Observer>} */
    this.observers = new Set();
  }

  get value() {
    track(this, this.observers);
    if (this.dirty) this.#recompute();
    return /** @type {T} */ (this.cached);
  }

  markDirty() {
    if (this.dirty) return;
    this.dirty = true;
    for (const o of [...this.observers]) o.markDirty();
  }

  #recompute() {
    for (const d of this.dependencies) d.observers.delete(this);
    this.dependencies.clear();
    const prev = current;
    current = this;
    try {
      const v = this.fn();
      this.dirty = false;
      if (this.cached === undefined || !this.equals(/** @type {T} */ (this.cached), v)) this.cached = v;
    } finally {
      current = prev;
    }
  }
}

export class Effect {
  /** @param {() => void} fn */
  constructor(fn) {
    this.fn = fn;
    /** @type {Set<Source>} */
    this.dependencies = new Set();
    this.disposed = false;
    this.run();
  }

  markDirty() {
    if (!this.disposed) queue.add(this);
  }

  run() {
    if (this.disposed) return;
    for (const d of this.dependencies) d.observers.delete(this);
    this.dependencies.clear();
    const prev = current;
    current = this;
    try {
      this.fn();
    } finally {
      current = prev;
    }
  }

  dispose() {
    this.disposed = true;
    queue.delete(this);
    for (const d of this.dependencies) d.observers.delete(this);
    this.dependencies.clear();
  }
}

export class Signals {
  /** Runs `fn` now and again (at the next flush) whenever a signal it read changes. @param {() => void} fn */
  static effect(fn) {
    const e = new Effect(fn);
    return () => e.dispose();
  }

  /** Runs the queued effects, each once. Effects queued while flushing run in the next flush. */
  static flush() {
    const batch = [...queue];
    queue.clear();
    for (const e of batch) e.run();
    return batch.length;
  }

  /** Effects waiting for the next flush. */
  static get pending() {
    return queue.size;
  }
}
