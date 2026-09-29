// @ts-check
import { Component } from '../../engine/ecs/component.js';

/** Run totals, fed by the swarm's reports at T + K. One per run. */
export class RunStats extends Component {
  static key = 'run-stats';
  static schema = /** @type {const} */ ({
    kills: 'i32', fired: 'i32', rejected: 'i32', damage: 'i32', downs: 'i32', alive: 'i32', shots: 'i32', waves: 'i32',
    scrap: 'i32', scrapDropped: 'i32', elites: 'i32', threat: 'i32',
  });
  /** @type {number} */ static kills;
  /** @type {number} */ static fired;
  /** @type {number} */ static rejected;
  /** @type {number} */ static damage;
  /** @type {number} */ static downs;
  /** @type {number} */ static alive;
  /** @type {number} */ static shots;
  /** @type {number} */ static waves;
  /** Scrap PATCH collected (exact: the swarm's per-proxy counter). */
  /** @type {number} */ static scrap;
  /** Scrap the swarm dropped; minus `scrap`, what lies on the ground (or waits in the swarm's carry). */
  /** @type {number} */ static scrapDropped;
  /** Elite kills, from the swarm's UNIT_DIED events. */
  /** @type {number} */ static elites;
  /** Threat points within 12 m of PATCH, from the swarm's threat map (at T − K). */
  /** @type {number} */ static threat;
}

/** Wave pacing: a ring of `count` units every `every` ticks, growing by `growth` per wave, up to `cap` alive. */
export class Director extends Component {
  static key = 'director';
  static schema = /** @type {const} */ ({ next: 'i32', every: 'i32', count: 'i32', growth: 'i32', cap: 'i32', r0: 'i32', r1: 'i32', stress: 'i32' });
  /** @type {number} */ static next;
  /** @type {number} */ static every;
  /** @type {number} */ static count;
  /** @type {number} */ static growth;
  /** @type {number} */ static cap;
  /** @type {number} */ static r0;
  /** @type {number} */ static r1;
  /** @type {number} */ static stress;
}
