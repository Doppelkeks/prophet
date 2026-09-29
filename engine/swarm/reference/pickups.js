// @ts-check
// Pass 13b: pickups. Each gem finds the nearest collector proxy whose magnet radius holds it (ties to the
// lower proxy index). Touching the collector collects it: its value goes to that proxy's scrap and to the
// tick's total, exactly. Otherwise it flies toward the collector. Gems never expire. Twin: kernels/pickups.wgsl.
import { Fixed } from '../../core/fixed.js';
import { OH, PICK_ALIVE, PROXY_WORDS } from '../swarm-layout.js';
import { ProxyFlag } from '../swarm-contract.js';
import { SwarmMath } from './swarm-math.js';

/** Pickup radius: 0.25 m (added to the collector's radius). */
export const PICKUP_RADIUS = 256;
/** Magnet speed: 12 m/s, faster than PATCH. */
export const MAGNET_SPEED = 205;

export class Pickups {
  static #step = new Int32Array(2);

  /** @param {import('./swarm-buffers.js').SwarmBuffers} b @param {import('./swarm-buffers.js').TickParams} p */
  static run(b, p) {
    const L = b.L;
    const step = Pickups.#step;
    const half = L.arenaHalf;
    const proxies = p.inBase + L.inProxies;
    for (let s = 0; s < L.pickCap; s++) {
      const info = b.P[L.kInfo + s];
      if ((info & PICK_ALIVE) === 0) continue;
      const x = b.Pi[L.kPosX + s];
      const y = b.Pi[L.kPosY + s];
      let best = -1;
      let bestD = 0x7fffffff;
      for (let q = 0; q < p.proxies; q++) {
        const at = proxies + q * PROXY_WORDS;
        if ((((b.I[at + 4] >>> 16) & 0xff) & ProxyFlag.COLLECTOR) === 0) continue;
        const mag = b.I[at + 6];
        const dx = b.I[at + 1] - x;
        const dy = b.I[at + 2] - y;
        if (dx > mag || dx < -mag || dy > mag || dy < -mag) continue;
        const d = Math.imul(dx, dx) + Math.imul(dy, dy);
        if (d > Math.imul(mag, mag)) continue;
        if (d < bestD) {
          bestD = d;
          best = q;
        }
      }
      if (best >= 0) {
        const at = proxies + best * PROXY_WORDS;
        const r = b.I[at + 3] + PICKUP_RADIUS;
        if (bestD <= Math.imul(r, r)) {
          const v = b.Pi[L.kValue + s];
          b.O[L.oProxyScrap + best] += v;
          b.O[OH.SCRAP_COLLECTED] += v;
          b.P[L.kInfo + s] = 0;
          continue;
        }
        SwarmMath.scaleTo(b.I[at + 1] - x, b.I[at + 2] - y, MAGNET_SPEED, step);
        b.Pi[L.kPosX + s] = Fixed.clamp(x + step[0], -half, half);
        b.Pi[L.kPosY + s] = Fixed.clamp(y + step[1], -half, half);
      }
      const age = info >>> 16;
      b.P[L.kInfo + s] = ((info & 0xffff) | ((age < 0xffff ? age + 1 : age) << 16)) >>> 0;
      b.O[OH.PICKUPS_ALIVE]++;
    }
  }
}
