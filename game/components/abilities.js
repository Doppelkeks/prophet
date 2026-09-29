// @ts-check
import { Component } from '../../engine/ecs/component.js';

/**
 * PATCH's active abilities in the tech demo (docs/game/02-content.md): the Stomper Legs' stomp on dash, and
 * Overclock with its energy meter. Ticks and whole energy points.
 */
export class Abilities extends Component {
  static key = 'abilities';
  static schema = /** @type {const} */ ({ stompCd: 'i32', energy: 'i32', overclock: 'i32', lastKills: 'i32', buttons: 'i32' });
  /** Ticks until the stomp is ready. */
  /** @type {number} */ static stompCd;
  /** Overclock energy, 0..ENERGY_FULL. */
  /** @type {number} */ static energy;
  /** Ticks of Overclock left. */
  /** @type {number} */ static overclock;
  /** The run's kill count when energy last counted kills. */
  /** @type {number} */ static lastKills;
  /** Last tick's buttons (to catch a fresh press). */
  /** @type {number} */ static buttons;
}
