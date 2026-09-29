// @ts-check
// Pass 13: targeting (docs/engine/05-gpu-swarm.md#pass-chain). Each fire command picks a live unit in range by
// its policy and requests a shot toward it for the next tick:
// - NEAREST minimizes (distance², slot); STRONGEST minimizes (−HP, slot).
// - PREFER_MARKED ranks every Marked unit before any unmarked one.
// - AIMED requests a shot along the command's angle, target or not.
// - CHAIN strikes the NEAREST pick at once (no shot), then bounces up to `bounces` times: each jump takes the
//   nearest unit within CHAIN_RANGE of the last one that the chain has not hit yet, with the damage scaled
//   by the falloff (Q8). A jump that finds nothing leaves the chain where it is, so later jumps find nothing
//   either. Chain damage lands in the accumulators after this tick's resolve: the next resolve applies it.
// Twin: kernels/targeting.wgsl (one workgroup per command, tree reductions).
import { Fixed } from '../../core/fixed.js';
import { CHAIN_RANGE, FIRE_WORDS, MAX_BOUNCES, OH, REQ_WORDS, UNIT_ALIVE } from '../swarm-layout.js';
import { FireFlag, Policy } from '../swarm-contract.js';
import { SwarmMath } from './swarm-math.js';

/** Unmarked units rank after every marked one under PREFER_MARKED (keys stay below 2^29 without it). */
export const MARK_PENALTY = 1 << 29;

const aim = new Int32Array(2);
const hits = new Int32Array(MAX_BOUNCES + 1);

export class Targeting {
  /** @param {import('./swarm-buffers.js').SwarmBuffers} b @param {import('./swarm-buffers.js').TickParams} p */
  static run(b, p) {
    const L = b.L;
    for (let k = 0; k < p.fires; k++) {
      const f = p.inBase + L.inFires + k * FIRE_WORDS;
      const w0 = b.I[f];
      const policy = (w0 >>> 16) & 0xff;
      const flags = w0 >>> 24;
      const range = b.I[f + 2];
      const ox = b.I[f + 4];
      const oy = b.I[f + 5];
      const shot = b.I[f + 6];
      const r = L.aReq + k * REQ_WORDS;
      if (policy === Policy.AIMED) {
        const a = b.I[f + 7] & 0xffff;
        const speed = shot & 0xffff;
        Targeting.#request(b, r, f, k, Fixed.mulShr(speed, Fixed.cosB(a), 14), Fixed.mulShr(speed, Fixed.sinB(a), 14));
        continue;
      }
      const best = Targeting.pick(b, ox, oy, range, policy === Policy.STRONGEST ? Policy.STRONGEST : Policy.NEAREST, flags, 0);
      if (best < 0) {
        b.A[r] = 0;
        continue;
      }
      if (policy === Policy.CHAIN) {
        b.A[r] = 0; // no shot: the chain strikes now
        let dmg = b.I[f + 3];
        const falloff = b.I[f + 1] & 0x1ff;
        const bounces = (b.I[f + 7] >>> 16) & 0xff;
        const source = w0 & 0xffff;
        Targeting.#strike(b, best, dmg, source);
        hits[0] = best;
        let n = 1;
        for (let jump = 0; jump < bounces; jump++) {
          dmg = (Math.imul(dmg, falloff) >> 8) | 0;
          const last = hits[n - 1];
          const next = Targeting.pick(b, b.Ui[L.uPosX + last], b.Ui[L.uPosY + last], CHAIN_RANGE, Policy.NEAREST, 0, n);
          if (next < 0) continue;
          Targeting.#strike(b, next, dmg, source);
          hits[n++] = next;
        }
        b.O[L.oFireBits + (k >>> 5)] |= 1 << (k & 31);
        b.O[OH.FIRED]++;
        continue;
      }
      SwarmMath.scaleTo(b.Ui[L.uPosX + best] - ox, b.Ui[L.uPosY + best] - oy, shot & 0xffff, aim);
      Targeting.#request(b, r, f, k, aim[0], aim[1]);
    }
  }

  /**
   * The best live unit within `range` of (ox, oy) by (key, slot), skipping the first `masked` entries of
   * `hits`. Key: distance² (NEAREST) or −HP (STRONGEST), plus MARK_PENALTY for unmarked units under
   * PREFER_MARKED. Returns the slot, or -1.
   * @param {import('./swarm-buffers.js').SwarmBuffers} b @param {number} ox @param {number} oy @param {number} range
   * @param {number} policy @param {number} flags @param {number} masked
   */
  static pick(b, ox, oy, range, policy, flags, masked) {
    const L = b.L;
    const W = L.gridW;
    const cr = (range >> L.cellShift) + 1;
    const cx = SwarmMath.cellX(L, ox);
    const cy = SwarmMath.cellY(L, oy);
    const x0 = cx - cr > 0 ? cx - cr : 0;
    const x1 = cx + cr < W - 1 ? cx + cr : W - 1;
    const y0 = cy - cr > 0 ? cy - cr : 0;
    const y1 = cy + cr < W - 1 ? cy + cr : W - 1;
    const r2 = Math.imul(range, range);
    let bestK = 0x7fffffff;
    let best = -1;
    for (let ny = y0; ny <= y1; ny++) {
      for (let nx = x0; nx <= x1; nx++) {
        const c = Math.imul(ny, W) + nx;
        const start = L.aBinEntries + b.A[L.aBinStart + c];
        const count = b.A[L.aBinCount + c];
        for (let e = 0; e < count; e++) {
          const j = b.A[start + e];
          if ((b.U[L.uInfo + j] & UNIT_ALIVE) === 0) continue;
          const dx = b.Ui[L.uPosX + j] - ox;
          const dy = b.Ui[L.uPosY + j] - oy;
          if (dx > range || dx < -range || dy > range || dy < -range) continue;
          const d = Math.imul(dx, dx) + Math.imul(dy, dy);
          if (d > r2) continue;
          let hit = false;
          for (let m = 0; m < masked; m++) if (hits[m] === j) hit = true;
          if (hit) continue;
          let key = policy === Policy.STRONGEST ? -b.Ui[L.uHp + j] : d;
          if (flags & FireFlag.PREFER_MARKED && (b.U[L.uSt1 + j] & 0xff) === 0) key += MARK_PENALTY;
          if (key < bestK || (key === bestK && j < best)) {
            bestK = key;
            best = j;
          }
        }
      }
    }
    return best;
  }

  /** Damage and kill credit, into the accumulators. @param {import('./swarm-buffers.js').SwarmBuffers} b @param {number} j @param {number} dmg @param {number} source */
  static #strike(b, j, dmg, source) {
    const L = b.L;
    b.A[L.aDmg + j] += dmg;
    const credit = ((((dmg >> 8) < 0x7ffe ? dmg >> 8 : 0x7ffe) + 1) << 16) | source;
    if (credit > b.A[L.aKiller + j]) b.A[L.aKiller + j] = credit;
  }

  /**
   * The shot request of command `k` (its slot in aReq), fired along (vx, vy).
   * @param {import('./swarm-buffers.js').SwarmBuffers} b @param {number} r @param {number} f @param {number} k @param {number} vx @param {number} vy
   */
  static #request(b, r, f, k, vx, vy) {
    const L = b.L;
    const shot = b.I[f + 6];
    b.A[r] = 1;
    b.A[r + 1] = b.I[f + 4];
    b.A[r + 2] = b.I[f + 5];
    b.A[r + 3] = SwarmMath.packVel(vx, vy);
    b.A[r + 4] = b.I[f + 3];
    b.A[r + 5] = (shot >>> 16) | (b.I[f + 1] & 0xff0000);
    b.A[r + 6] = b.I[f] & 0xffff;
    b.A[r + 7] = 0;
    b.O[L.oFireBits + (k >>> 5)] |= 1 << (k & 31);
    b.O[OH.FIRED]++;
  }
}
