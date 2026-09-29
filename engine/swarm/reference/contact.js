// @ts-check
// Pass 12: contact damage on player proxies from overlapping live units, each at its type's attack
// cadence ((tick + anim phase) mod interval = 0); stunned units don't strike. Per-proxy sums commute.
// Twin: kernels/contact.wgsl.
import { Fixed } from '../../core/fixed.js';
import { OH, PROXY_WORDS, TY, TYPE_WORDS, UNIT_ALIVE } from '../swarm-layout.js';
import { Team } from '../swarm-contract.js';
import { SwarmMath } from './swarm-math.js';

export class Contact {
  /** @param {import('./swarm-buffers.js').SwarmBuffers} b @param {import('./swarm-buffers.js').TickParams} p */
  static run(b, p) {
    const L = b.L;
    const W = L.gridW;
    for (let k = 0; k < p.proxies; k++) {
      const q = p.inBase + L.inProxies + k * PROXY_WORDS;
      if ((b.I[q + 4] & 0xff) !== Team.PLAYER) continue;
      const qx = b.I[q + 1];
      const qy = b.I[q + 2];
      const qr = b.I[q + 3];
      const cx = SwarmMath.cellX(L, qx);
      const cy = SwarmMath.cellY(L, qy);
      let total = 0;
      let hits = 0;
      for (let oy = -1; oy <= 1; oy++) {
        const ny = cy + oy;
        if (ny < 0 || ny >= W) continue;
        for (let ox = -1; ox <= 1; ox++) {
          const nx = cx + ox;
          if (nx < 0 || nx >= W) continue;
          const c = Math.imul(ny, W) + nx;
          const start = L.aBinEntries + b.A[L.aBinStart + c];
          const count = b.A[L.aBinCount + c];
          for (let e = 0; e < count; e++) {
            const j = b.A[start + e];
            const info = b.U[L.uInfo + j];
            if ((info & UNIT_ALIVE) === 0) continue;
            if (b.U[L.uSt0 + j] >>> 24 !== 0) continue; // stunned
            const type = L.tTypes + (info & 0xff) * TYPE_WORDS;
            const r = qr + b.T[type + TY.RADIUS];
            const dx = b.Ui[L.uPosX + j] - qx;
            const dy = b.Ui[L.uPosY + j] - qy;
            if (dx > r || dx < -r || dy > r || dy < -r) continue;
            if (Math.imul(dx, dx) + Math.imul(dy, dy) > Math.imul(r, r)) continue;
            if (Fixed.umod(p.tick + (info >>> 24), b.T[type + TY.TIMING] & 0xff) !== 0) continue;
            total += b.T[type + TY.CONTACT];
            hits++;
          }
        }
      }
      b.O[L.oProxyDmg + k] += total;
      b.O[OH.CONTACT_HITS] += hits;
    }
  }
}
