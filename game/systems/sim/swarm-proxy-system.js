// @ts-check
import { System } from '../../../engine/ecs/system.js';
import { Health, Pilot, Transform } from '../../components/index.js';
import { ProxyFlag, Team } from '../../../engine/swarm/swarm-contract.js';
import { PATCH_MAGNET, PATCH_RADIUS } from '../../data/arena.js';

/** The proxy command, reused every tick (the swarm copies it into the tick's block). */
const PROXY = { entity: 0, x: 0, y: 0, radius: PATCH_RADIUS, team: Team.PLAYER, flags: ProxyFlag.TARGETABLE | ProxyFlag.PUSHES | ProxyFlag.COLLECTOR, hp: 0, aux: PATCH_MAGNET };

/**
 * Uploads PATCH as the swarm's proxy 0: the swarm chases it, is pushed off it, and damages it on contact;
 * scrap gems inside its magnet radius fly to it.
 */
export class SwarmProxySystem extends System {
  static key = 'swarm-proxy';
  static stage = /** @type {const} */ ('PostSim');
  static reads = [Pilot, Transform, Health];
  static query = { all: [Pilot, Transform, Health] };
  static parallel = /** @type {const} */ ('serial');

  /** @type {System['run']} */
  run(c) {
    const i32 = this.heap.i32;
    const swarm = this.ecs.resources.swarm;
    if (!swarm) return;
    const x = c.col(Transform.x);
    const y = c.col(Transform.y);
    const hp = c.col(Health.hp);
    for (let r = 0; r < c.count; r++) {
      PROXY.entity = c.entity(r);
      PROXY.x = i32[x + r];
      PROXY.y = i32[y + r];
      PROXY.hp = i32[hp + r];
      swarm.proxy(PROXY);
    }
  }
}
