// @ts-check
// Flow fields (docs/engine/06-world.md#navigation): Dial's bucket-queue Dijkstra over a nav cost grid, then a
// direction pass. Integer-only, deterministic and allocation-free after construction (sim-linted).
// - Costs: 0 blocked; 1 open; 2..15 slow ground (step × value). Straight steps cost 10, diagonals 14, and a
//   diagonal never cuts a corner (both orthogonal neighbours must be passable).
// - Output: one u32 per cell, `angle | dist << 16` (see FlowField.pack): the binary angle toward the lowest
//   neighbour (ties in the fixed neighbour order) and the saturated distance; NO_PATH for blocked and
//   unreachable cells; distance 0 marks the goal.
import { Fixed } from '../../core/fixed.js';

/** Distance code of blocked or unreachable cells. */
export const NO_PATH = 0xffff;
const INF = 0x7fffffff;
const STRAIGHT = 10;
const DIAGONAL = 14;
const MAX_COST = 15;
/** Neighbour order (fixed: it breaks ties): E, W, N, S, NE, NW, SE, SW. y grows north. */
const DX = Int32Array.of(1, -1, 0, 0, 1, -1, 1, -1);
const DY = Int32Array.of(0, 0, 1, -1, 1, 1, -1, -1);
/** Binary angle of each neighbour direction (0 = +x, 16384 = +y). */
const ANGLE = Int32Array.of(0, 32768, 16384, 49152, 8192, 24576, 57344, 40960);

export class FlowField {
  /** @param {number} w grid width in cells @param {number} h grid height in cells */
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.nb = DIAGONAL * MAX_COST + 1; // circular buckets: every queued distance is within one step
    this.dist = new Int32Array(w * h);
    this.next = new Int32Array(w * h);
    this.prev = new Int32Array(w * h);
    this.head = new Int32Array(this.nb);
    /** The packed field of the last solve. */
    this.out = new Int32Array(w * h);
  }

  /** @param {number} angle @param {number} dist */
  static pack(angle, dist) {
    return ((angle & 0xffff) | ((dist < NO_PATH ? dist : NO_PATH) << 16)) | 0;
  }

  /**
   * Solves toward one goal cell and writes `out`.
   * @param {Uint8Array} cost per cell @param {number} goal cell index
   * @returns {Int32Array} the packed field
   */
  solve(cost, goal) {
    const w = this.w;
    const h = this.h;
    const nb = this.nb;
    const dist = this.dist;
    const head = this.head;
    dist.fill(INF);
    head.fill(-1);
    let queued = 0;
    if (goal >= 0 && goal < w * h && cost[goal] !== 0) {
      dist[goal] = 0;
      this.#link(0, goal);
      queued = 1;
    }
    for (let d = 0; queued > 0; d++) {
      const b = Fixed.umod(d, nb);
      for (let c = head[b]; c !== -1; c = head[b]) {
        this.#unlink(b, c);
        queued--;
        const x = Fixed.umod(c, w);
        const y = Fixed.udiv(c, w);
        for (let k = 0; k < 8; k++) {
          const nx = x + DX[k];
          const ny = y + DY[k];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = Math.imul(ny, w) + nx;
          const cn = cost[n];
          if (cn === 0) continue;
          if (k >= 4 && (cost[Math.imul(y, w) + nx] === 0 || cost[Math.imul(ny, w) + x] === 0)) continue; // no corner cutting
          const nd = d + Math.imul(k < 4 ? STRAIGHT : DIAGONAL, cn < MAX_COST ? cn : MAX_COST);
          if (nd >= dist[n]) continue;
          if (dist[n] !== INF) {
            this.#unlink(Fixed.umod(dist[n], nb), n);
            queued--;
          }
          dist[n] = nd;
          this.#link(Fixed.umod(nd, nb), n);
          queued++;
        }
      }
    }
    this.#directions(cost);
    return this.out;
  }

  /** Points every reachable cell at its lowest neighbour (same corner rule), ties in neighbour order. @param {Uint8Array} cost */
  #directions(cost) {
    const w = this.w;
    const h = this.h;
    const dist = this.dist;
    const out = this.out;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = Math.imul(y, w) + x;
        const dc = dist[c];
        if (dc === INF) {
          out[c] = FlowField.pack(0, NO_PATH);
          continue;
        }
        let best = -1;
        let bestD = dc;
        for (let k = 0; k < 8; k++) {
          const nx = x + DX[k];
          const ny = y + DY[k];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (k >= 4 && (cost[Math.imul(y, w) + nx] === 0 || cost[Math.imul(ny, w) + x] === 0)) continue;
          const dn = dist[Math.imul(ny, w) + nx];
          if (dn < bestD) {
            bestD = dn;
            best = k;
          }
        }
        out[c] = FlowField.pack(best < 0 ? 0 : ANGLE[best], dc);
      }
    }
  }

  /** @param {number} b @param {number} c */
  #link(b, c) {
    const f = this.head[b];
    this.prev[c] = -1;
    this.next[c] = f;
    if (f !== -1) this.prev[f] = c;
    this.head[b] = c;
  }

  /** @param {number} b @param {number} c */
  #unlink(b, c) {
    const p = this.prev[c];
    const n = this.next[c];
    if (p !== -1) this.next[p] = n;
    else this.head[b] = n;
    if (n !== -1) this.prev[n] = p;
  }
}
