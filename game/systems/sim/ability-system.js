// @ts-check
import { Fixed } from '../../../engine/core/fixed.js';
import { System } from '../../../engine/ecs/system.js';
import { Buttons, InputRecord } from '../../../engine/input/input-record.js';
import { Status } from '../../../engine/swarm/swarm-contract.js';
import { Abilities, Pilot, RunStats, Transform } from '../../components/index.js';
import { OVERCLOCK, STOMP } from '../../data/abilities.js';

/**
 * PATCH's abilities as swarm area effects (docs/engine/05-gpu-swarm.md#cpu-gpu-contract): holding dash
 * stomps whenever the stomp is ready (3 m, damage, knockback, Stun); a fresh Overclock press with a full
 * meter starts Overclock and its 6 m knockback pulse. The meter fills over time and with kills. Runs after
 * movement, so effects center on where PATCH is this tick. Reads engine resources: serial.
 */
export class AbilitySystem extends System {
  static key = 'abilities';
  static stage = /** @type {const} */ ('Sim');
  static reads = [Pilot, Transform, RunStats];
  static writes = [Abilities];
  static after = ['movement'];
  static query = { all: [Pilot, Transform, Abilities] };
  static parallel = /** @type {const} */ ('serial');

  /** @type {System['run']} */
  run(c) {
    const i32 = this.heap.i32;
    const res = this.ecs.resources;
    const swarm = res.swarm;
    const buttons = InputRecord.buttons(res.input.w1);
    const kills = this.ecs.reader.get(res.run, RunStats.kills);
    const x = c.col(Transform.x);
    const y = c.col(Transform.y);
    const cd = c.col(Abilities.stompCd);
    const energy = c.col(Abilities.energy);
    const oc = c.col(Abilities.overclock);
    const last = c.col(Abilities.lastKills);
    const prev = c.col(Abilities.buttons);
    for (let r = 0; r < c.count; r++) {
      let e = i32[energy + r] + Math.imul(kills - i32[last + r], OVERCLOCK.perKill);
      if (Fixed.umod(res.tick, OVERCLOCK.fillEvery) === 0) e++;
      i32[last + r] = kills;
      if (i32[oc + r] > 0) i32[oc + r]--;
      if (i32[cd + r] > 0) i32[cd + r]--;
      const pressed = buttons & ~i32[prev + r];
      i32[prev + r] = buttons;
      if (swarm && buttons & Buttons.DASH && i32[cd + r] === 0) {
        swarm.effect({ x: i32[x + r], y: i32[y + r], radius: STOMP.radius, damage: STOMP.damage, impulse: STOMP.impulse, status: Status.STUNNED, tier: STOMP.tier, source: STOMP.source });
        i32[cd + r] = STOMP.cooldown;
      }
      if (swarm && pressed & Buttons.OVERCLOCK && e >= OVERCLOCK.full && i32[oc + r] === 0) {
        swarm.effect({ x: i32[x + r], y: i32[y + r], radius: OVERCLOCK.pulseRadius, impulse: OVERCLOCK.pulseImpulse, source: OVERCLOCK.source });
        i32[oc + r] = OVERCLOCK.duration;
        e = 0;
      }
      i32[energy + r] = Fixed.clamp(e, 0, OVERCLOCK.full);
    }
  }
}
