// @ts-check
import { System } from '../../../engine/ecs/system.js';
import { Policy } from '../../../engine/swarm/swarm-contract.js';
import { Arc, Transform } from '../../components/index.js';

/** Fires chain weapons: WHEN and HOW HARD on the CPU, WHO (and where the arc jumps) on the GPU. */
export class ArcSystem extends System {
  static key = 'arc';
  static stage = /** @type {const} */ ('Sim');
  static reads = [Transform];
  static writes = [Arc];
  static after = ['movement'];
  static query = { all: [Arc, Transform] };
  static parallel = /** @type {const} */ ('serial');

  /** @type {System['run']} */
  run(c) {
    const h = this.heap;
    const i32 = h.i32;
    const swarm = this.ecs.resources.swarm;
    if (!swarm) return;
    const cd = c.col(Arc.cooldown);
    const every = c.col(Arc.interval);
    const range = c.col(Arc.range);
    const dmg = c.col(Arc.damage);
    const bounces = c.col(Arc.bounces);
    const falloff = c.col(Arc.falloff);
    const source = c.col(Arc.source);
    const x = c.col(Transform.x);
    const y = c.col(Transform.y);
    for (let r = 0; r < c.count; r++) {
      if (i32[cd + r] > 1) {
        i32[cd + r]--;
        continue;
      }
      i32[cd + r] = i32[every + r];
      swarm.fire({
        source: h.u8[source + r],
        x: i32[x + r],
        y: i32[y + r],
        range: i32[range + r],
        damage: i32[dmg + r],
        speed: 1,
        life: 1,
        policy: Policy.CHAIN,
        bounces: h.u8[bounces + r],
        falloff: h.u16[falloff + r],
      });
    }
  }
}
