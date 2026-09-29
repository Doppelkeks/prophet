// @ts-check
// 32-bit state hash (MurmurHash3 x86_32 structure) for replays, determinism tests and desync checks
// (docs/engine/09-determinism-coop.md#replays-and-hashes). Twin: engine/gpu/wgsl/hash.wgsl.

export class Hash32 {
  /** @param {number} [seed] */
  static begin(seed = 0) {
    return seed >>> 0;
  }

  /** Mixes one u32 word into the running hash. @param {number} h @param {number} w */
  static step(h, w) {
    let k = Math.imul(w, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    return (Math.imul(h, 5) + 0xe6546b64) >>> 0;
  }

  /** Finalizes; `words` is the number of words mixed in. @param {number} h @param {number} words */
  static end(h, words) {
    h ^= Math.imul(words, 4);
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  }

  /**
   * Hashes `count` words of a typed array starting at `offset`.
   * @param {Uint32Array | Int32Array} words @param {number} offset @param {number} count @param {number} [seed]
   */
  static words(words, offset, count, seed = 0) {
    let h = Hash32.begin(seed);
    for (let i = 0; i < count; i++) h = Hash32.step(h, words[offset + i]);
    return Hash32.end(h, count);
  }
}
