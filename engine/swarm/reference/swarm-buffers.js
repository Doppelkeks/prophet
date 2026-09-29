// @ts-check
// The six swarm buffers as typed arrays, with the same packed layout as the GPU buffers.

/**
 * Per-tick parameters (the `TickParams` uniform on the GPU).
 * @typedef {object} TickParams
 * @property {number} tick
 * @property {number} inBase word offset of this tick's block in the inbound ring
 * @property {number} prevFires fire commands of the previous tick (its shot requests spawn now)
 * @property {number} groups
 * @property {number} fires
 * @property {number} proxies
 * @property {number} effects
 * @property {number} requests units requested by this tick's spawn groups
 * @property {number} flags bit 0: swarm reset, bit 1: field swap
 * @property {number} field the flow-field half this tick reads (0 or 1), or FIELD_NONE
 */

export class SwarmBuffers {
  /**
   * @param {import('../swarm-layout.js').SwarmLayout} layout
   * @param {Int32Array} tables the T buffer (SwarmTables.build)
   * @param {{ keySpawnA: number, keySpawnR: number, keyPhase: number, keyDrop: number }} keys
   */
  constructor(layout, tables, keys) {
    const w = layout.words;
    /** @type {Record<string, number>} layout words, with the run's RNG keys */
    this.L = { ...layout.L, ...keys };
    this.U = new Uint32Array(w.U);
    this.Ui = new Int32Array(this.U.buffer);
    this.P = new Uint32Array(w.P);
    this.Pi = new Int32Array(this.P.buffer);
    this.A = new Int32Array(w.A);
    this.Au = new Uint32Array(this.A.buffer);
    this.I = new Int32Array(w.I);
    this.O = new Int32Array(w.O);
    this.T = tables;
    this.G = new Int32Array(w.G);
  }
}
