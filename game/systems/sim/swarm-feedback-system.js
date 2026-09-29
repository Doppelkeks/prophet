// @ts-check
import { System } from '../../../engine/ecs/system.js';
import { Health, RunStats } from '../../components/index.js';

/**
 * Applies the swarm's report of tick T − K: contact damage to PATCH (proxy 0) and the run totals.
 * Runs first in the tick, on the engine thread.
 */
export class SwarmFeedbackSystem extends System {
  static key = 'swarm-feedback';
  static stage = /** @type {const} */ ('Input');
  static reads = [Health, RunStats];

  /** @type {System['update']} */
  update(cmd) {
    const res = this.ecs.resources;
    const out = res.swarmOut;
    if (!out) return;
    const reader = this.ecs.reader;
    const run = res.run;
    const patch = res.patch;
    const damage = out.proxyDamage(0);
    let hp = reader.get(patch, Health.hp) - damage;
    let downs = reader.get(run, RunStats.downs);
    if (hp <= 0) {
      hp = reader.get(patch, Health.max); // the tech demo has no game over: PATCH reboots
      downs++;
    }
    cmd.set(patch, Health.hp, hp);
    cmd.set(run, RunStats.downs, downs);
    cmd.set(run, RunStats.kills, reader.get(run, RunStats.kills) + out.kills);
    cmd.set(run, RunStats.fired, reader.get(run, RunStats.fired) + out.fired);
    cmd.set(run, RunStats.rejected, reader.get(run, RunStats.rejected) + out.spawnsRejected);
    cmd.set(run, RunStats.damage, reader.get(run, RunStats.damage) + damage);
    cmd.set(run, RunStats.alive, out.unitsAlive);
    cmd.set(run, RunStats.shots, out.shotsAlive);
  }
}
