// @ts-check
import { Component } from '../../engine/ecs/component.js';

/** A player-controlled actor (PATCH). `speed` is the top speed in Q10 meters per tick. */
export class Pilot extends Component {
  static key = 'pilot';
  static schema = /** @type {const} */ ({ speed: 'i32', player: 'u8' });
  /** @type {number} */ static speed;
  /** @type {number} */ static player;
}
