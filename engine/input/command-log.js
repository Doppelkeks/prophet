// @ts-check
// The command log (docs/engine/09-determinism-coop.md#replays-and-hashes): one input record per tick,
// in tick order. The sim reads its input only from here, so a log replays a run exactly.
import { Hash32 } from '../core/hash32.js';

export class CommandLog {
  static VERSION = 1;

  constructor() {
    this.words = new Uint32Array(2 * 4096);
    /** Ticks recorded. */
    this.length = 0;
  }

  /**
   * Records the input of `tick`, which must be the next unrecorded tick.
   * @param {number} tick @param {number} w0 @param {number} w1
   */
  set(tick, w0, w1) {
    if (tick !== this.length) throw new Error(`command log: tick ${tick} recorded out of order (next is ${this.length})`);
    if (2 * tick + 2 > this.words.length) {
      const grown = new Uint32Array(this.words.length * 2);
      grown.set(this.words);
      this.words = grown;
    }
    this.words[2 * tick] = w0;
    this.words[2 * tick + 1] = w1;
    this.length = tick + 1;
  }

  /** Whether a tick has a record. @param {number} tick */
  has(tick) {
    return tick >= 0 && tick < this.length;
  }

  /** @param {number} tick */
  w0(tick) {
    return this.words[2 * tick];
  }

  /** @param {number} tick */
  w1(tick) {
    return this.words[2 * tick + 1];
  }

  hash() {
    return Hash32.words(this.words, 0, 2 * this.length);
  }

  toJSON() {
    return { version: CommandLog.VERSION, ticks: this.length, words: Array.from(this.words.subarray(0, 2 * this.length)) };
  }

  /** @param {{ version: number, ticks: number, words: number[] }} json */
  static fromJSON(json) {
    if (json.version !== CommandLog.VERSION) throw new Error(`command log: unsupported version ${json.version}`);
    const log = new CommandLog();
    for (let t = 0; t < json.ticks; t++) log.set(t, json.words[2 * t] >>> 0, json.words[2 * t + 1] >>> 0);
    return log;
  }
}
