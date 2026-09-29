// @ts-check
import { Fixed } from '../../../engine/core/fixed.js';
import { System } from '../../../engine/ecs/system.js';
import { Motion, Transform } from '../../components/index.js';
import { ARENA_HALF } from '../../data/arena.js';

/** Integrates velocity and keeps actors inside the arena. */
export class MovementSystem extends System {
  static key = 'movement';
  static stage = /** @type {const} */ ('Sim');
  static reads = [Motion];
  static writes = [Transform];
  static query = { all: [Transform, Motion] };

  /** @type {System['run']} */
  run(c) {
    const i32 = this.heap.i32;
    const x = c.col(Transform.x);
    const y = c.col(Transform.y);
    const vx = c.col(Motion.vx);
    const vy = c.col(Motion.vy);
    for (let r = 0; r < c.count; r++) {
      i32[x + r] = Fixed.clamp(i32[x + r] + i32[vx + r], -ARENA_HALF, ARENA_HALF);
      i32[y + r] = Fixed.clamp(i32[y + r] + i32[vy + r], -ARENA_HALF, ARENA_HALF);
    }
  }
}
