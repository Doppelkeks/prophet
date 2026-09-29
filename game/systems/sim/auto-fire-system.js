// @ts-check
import { Fixed } from '../../../engine/core/fixed.js';
import { System } from '../../../engine/ecs/system.js';
import { Abilities, Gun, Transform } from '../../components/index.js';
import { OVERCLOCK } from '../../data/abilities.js';

/** Decides WHEN a gun fires and WHAT it fires; the GPU decides WHO it hits (docs/engine/05-gpu-swarm.md). */
export class AutoFireSystem extends System {
  static key = 'auto-fire';
  static stage = /** @type {const} */ ('Sim');
  static reads = [Transform, Abilities];
  static writes = [Gun];
  static after = ['movement']; // fire from where PATCH is after this tick's move
  static query = { all: [Gun, Transform, Abilities] };
  static parallel = /** @type {const} */ ('serial');

  /** @type {System['run']} */
  run(c) {
    const h = this.heap;
    const i32 = h.i32;
    const swarm = this.ecs.resources.swarm;
    if (!swarm) return;
    const cd = c.col(Gun.cooldown);
    const every = c.col(Gun.interval);
    const range = c.col(Gun.range);
    const dmg = c.col(Gun.damage);
    const speed = c.col(Gun.speed);
    const life = c.col(Gun.life);
    const pierce = c.col(Gun.pierce);
    const source = c.col(Gun.source);
    const x = c.col(Transform.x);
    const y = c.col(Transform.y);
    const oc = c.col(Abilities.overclock);
    for (let r = 0; r < c.count; r++) {
      if (i32[cd + r] > 1) {
        i32[cd + r]--;
        continue;
      }
      // Overclock: +40 % fire rate (interval × 5/7).
      i32[cd + r] = i32[oc + r] > 0 ? Fixed.idiv(Math.imul(i32[every + r], OVERCLOCK.fireNum), OVERCLOCK.fireDen) : i32[every + r];
      swarm.fire({ source: h.u8[source + r], x: i32[x + r], y: i32[y + r], range: i32[range + r], damage: i32[dmg + r], speed: h.u16[speed + r], life: h.u16[life + r], pierce: h.u8[pierce + r] });
    }
  }
}
