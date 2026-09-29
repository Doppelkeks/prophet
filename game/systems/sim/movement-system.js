// @ts-check
import { Fixed } from '../../../engine/core/fixed.js';
import { System } from '../../../engine/ecs/system.js';
import { Motion, Transform } from '../../components/index.js';
import { ARENA_COST, ARENA_HALF, navCell } from '../../data/arena.js';

/** Integrates velocity, keeps actors inside the arena, and slides them along obstacles (x step, then y step). */
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
      const x0 = i32[x + r];
      const y0 = i32[y + r];
      let nx = Fixed.clamp(x0 + i32[vx + r], -ARENA_HALF, ARENA_HALF);
      if (ARENA_COST[navCell(nx, y0)] === 0) nx = x0;
      let ny = Fixed.clamp(y0 + i32[vy + r], -ARENA_HALF, ARENA_HALF);
      if (ARENA_COST[navCell(nx, ny)] === 0) ny = y0;
      i32[x + r] = nx;
      i32[y + r] = ny;
    }
  }
}
