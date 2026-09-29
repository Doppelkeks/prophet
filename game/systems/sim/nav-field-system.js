// @ts-check
import { System } from '../../../engine/ecs/system.js';
import { NavField, Transform } from '../../components/index.js';
import { ARENA_COST, L_FIELD, navCell } from '../../data/arena.js';

/**
 * The player flow field (docs/engine/06-world.md#navigation): when PATCH enters a new cell, a solve toward it
 * is requested (at most every L_FIELD ticks) and committed to the swarm L_FIELD ticks later, from the cell of
 * the request tick, so every machine commits the same field on the same tick. After a swarm reset the field
 * is committed at once (a reset swarm has none). Runs serially: it solves on the engine thread and writes
 * the swarm's inbound block.
 */
export class NavFieldSystem extends System {
  static key = 'nav-field';
  static stage = /** @type {const} */ ('PostSim');
  static reads = [NavField, Transform];

  /** @type {System['update']} */
  update(cmd) {
    const res = this.ecs.resources;
    const swarm = res.swarm;
    if (!swarm) return;
    const reader = this.ecs.reader;
    const run = res.run;
    const tick = res.tick;
    const cell = navCell(reader.get(res.patch, Transform.x), reader.get(res.patch, Transform.y));
    let goal = reader.get(run, NavField.goal);
    let requested = reader.get(run, NavField.requested);
    let pending = reader.get(run, NavField.pending);
    let committed = reader.get(run, NavField.committed);
    if (res.swarmReset) {
      swarm.setField(res.flow.solve(ARENA_COST, cell));
      goal = cell;
      pending = 0;
      committed = tick;
    } else if (pending && tick >= requested + L_FIELD) {
      swarm.setField(res.flow.solve(ARENA_COST, goal));
      pending = 0;
      committed = tick;
    } else if (!pending && cell !== goal && tick >= requested + L_FIELD) {
      goal = cell;
      requested = tick;
      pending = 1;
    }
    cmd.set(run, NavField.goal, goal);
    cmd.set(run, NavField.requested, requested);
    cmd.set(run, NavField.pending, pending);
    cmd.set(run, NavField.committed, committed);
  }
}
