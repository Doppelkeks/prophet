// @ts-check
// The command log (docs/engine/09-determinism-coop.md#input-as-commands): one input record per tick,
// in tick order, plus the UI commands stamped on that tick. The sim reads its input only from here, so a
// log replays a run exactly.
import { Hash32 } from '../core/hash32.js';

/** Words per UI command record: code, a, b (the game defines the codes). */
export const UI_WORDS = 3;
/** UI commands per tick: the count lives in bits 24-31 of the record's word 1. */
export const UI_MAX = 255;

export class CommandLog {
  static VERSION = 2;

  constructor() {
    this.words = new Uint32Array(2 * 4096);
    /** Ticks recorded. */
    this.length = 0;
    /** UI command records of every tick, in tick order. */
    this.uiWords = new Uint32Array(UI_WORDS * 256);
    this.uiLength = 0;
    /** Per tick: its first UI command record, in words into `uiWords`. */
    this.uiStart = new Uint32Array(4096);
  }

  /**
   * Records the input of `tick`, which must be the next unrecorded tick. The UI command count in bits
   * 24-31 of `w1` is replaced by `uiCount`.
   * @param {number} tick @param {number} w0 @param {number} w1
   * @param {Uint32Array | null} [ui] UI command records, `UI_WORDS` each
   * @param {number} [uiCount]
   */
  set(tick, w0, w1, ui = null, uiCount = 0) {
    if (tick !== this.length) throw new Error(`command log: tick ${tick} recorded out of order (next is ${this.length})`);
    if (uiCount < 0 || uiCount > UI_MAX) throw new Error(`command log: ${uiCount} UI commands on one tick (at most ${UI_MAX})`);
    if (2 * tick + 2 > this.words.length) {
      const grown = new Uint32Array(this.words.length * 2);
      grown.set(this.words);
      this.words = grown;
      const starts = new Uint32Array(this.uiStart.length * 2);
      starts.set(this.uiStart);
      this.uiStart = starts;
    }
    const n = uiCount * UI_WORDS;
    if (this.uiLength + n > this.uiWords.length) {
      const grown = new Uint32Array(Math.max(this.uiWords.length * 2, this.uiLength + n));
      grown.set(this.uiWords);
      this.uiWords = grown;
    }
    this.uiStart[tick] = this.uiLength;
    for (let i = 0; i < n; i++) this.uiWords[this.uiLength + i] = /** @type {Uint32Array} */ (ui)[i];
    this.uiLength += n;
    this.words[2 * tick] = w0;
    this.words[2 * tick + 1] = ((w1 & 0xffffff) | (uiCount << 24)) >>> 0;
    this.length = tick + 1;
  }

  /**
   * Adds UI commands to the last recorded tick, which has not run yet (an engine command that must land
   * on a tick already stamped, such as a swarm reset while that tick is stalled).
   * @param {number} tick must be the last recorded tick @param {Uint32Array} ui @param {number} uiCount
   */
  amend(tick, ui, uiCount) {
    if (tick !== this.length - 1) throw new Error(`command log: only the last tick (${this.length - 1}) can be amended, not ${tick}`);
    const had = this.uiCount(tick);
    if (had + uiCount > UI_MAX) throw new Error(`command log: ${had + uiCount} UI commands on one tick (at most ${UI_MAX})`);
    const n = uiCount * UI_WORDS;
    if (this.uiLength + n > this.uiWords.length) {
      const grown = new Uint32Array(Math.max(this.uiWords.length * 2, this.uiLength + n));
      grown.set(this.uiWords);
      this.uiWords = grown;
    }
    for (let i = 0; i < n; i++) this.uiWords[this.uiLength + i] = ui[i];
    this.uiLength += n;
    const w1 = this.words[2 * tick + 1];
    this.words[2 * tick + 1] = ((w1 & 0xffffff) | ((had + uiCount) << 24)) >>> 0;
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

  /** UI commands stamped on a tick. @param {number} tick */
  uiCount(tick) {
    return this.words[2 * tick + 1] >>> 24;
  }

  /** The tick's first UI command, in words into `uiWords`. @param {number} tick */
  uiAt(tick) {
    return this.uiStart[tick];
  }

  hash() {
    return Hash32.words(this.uiWords, 0, this.uiLength, Hash32.words(this.words, 0, 2 * this.length));
  }

  toJSON() {
    return {
      version: CommandLog.VERSION,
      ticks: this.length,
      words: Array.from(this.words.subarray(0, 2 * this.length)),
      ui: Array.from(this.uiWords.subarray(0, this.uiLength)),
    };
  }

  /** @param {{ version: number, ticks: number, words: number[], ui?: number[] }} json */
  static fromJSON(json) {
    if (json.version !== CommandLog.VERSION) throw new Error(`command log: unsupported version ${json.version}`);
    const log = new CommandLog();
    const ui = Uint32Array.from(json.ui ?? []);
    let at = 0;
    for (let t = 0; t < json.ticks; t++) {
      const w1 = json.words[2 * t + 1] >>> 0;
      const n = w1 >>> 24;
      log.set(t, json.words[2 * t] >>> 0, w1, ui.subarray(at, at + n * UI_WORDS), n);
      at += n * UI_WORDS;
    }
    if (at !== ui.length) throw new Error('command log: UI command records do not match the per-tick counts');
    return log;
  }
}
