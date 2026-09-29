// @ts-check
import { Fixed } from '../../../engine/core/fixed.js';
import { System } from '../../../engine/ecs/system.js';
import { Director, RunStats, Transform } from '../../components/index.js';
import { THREAT_CAP } from '../../data/abilities.js';

/**
 * Decides WHEN and WHAT spawns (the GPU decides where exactly): a ring of units around PATCH every
 * wave, growing each wave, throttled by the alive count reported at T − K. While the threat around PATCH
 * (the swarm's threat map) is at the cap, the wave waits half a second.
 */
export class DirectorSystem extends System {
  static key = 'director';
  static stage = /** @type {const} */ ('PreSim');
  static reads = [Director, RunStats, Transform];

  /** @type {System['update']} */
  update(cmd) {
    const res = this.ecs.resources;
    if (!res.swarm) return;
    const reader = this.ecs.reader;
    const d = res.run;
    const tick = res.tick;
    if (tick < reader.get(d, Director.next)) return;
    const waves = reader.get(d, RunStats.waves);
    const stress = reader.get(d, Director.stress);
    if (reader.get(d, RunStats.threat) >= Math.imul(THREAT_CAP, 1 + stress)) {
      cmd.set(d, Director.next, tick + 30);
      return;
    }
    const base = reader.get(d, Director.count) + Math.imul(waves, reader.get(d, Director.growth));
    const count = Math.imul(base, 1 + stress);
    const room = reader.get(d, Director.cap) - reader.get(d, RunStats.alive);
    const n = Fixed.clamp(count, 0, room);
    if (n > 0) {
      const x = reader.get(res.patch, Transform.x);
      const y = reader.get(res.patch, Transform.y);
      const r0 = reader.get(d, Director.r0);
      const r1 = reader.get(d, Director.r1);
      // Mostly Scrubbers, a Mite pack every other wave, Brutes from wave 4.
      const mites = waves & 1 ? n >> 2 : 0;
      const brutes = waves >= 4 ? n >> 4 : 0;
      const swarm = res.swarm;
      swarm.spawnRing({ type: 0, count: n - mites - brutes, cx: x, cy: y, r0, r1 });
      if (mites) swarm.spawnRing({ type: 1, count: mites, cx: x, cy: y, r0: r1, r1: r1 + (r1 - r0) });
      if (brutes) swarm.spawnRing({ type: 2, count: brutes, cx: x, cy: y, r0, r1 });
    }
    cmd.set(d, Director.next, tick + reader.get(d, Director.every));
    cmd.set(d, RunStats.waves, waves + 1);
  }
}
