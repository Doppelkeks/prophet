// @ts-check
import { Component } from '../../engine/ecs/component.js';

/** Velocity in Q10 meters per tick. */
export class Motion extends Component {
  static key = 'motion';
  static schema = /** @type {const} */ ({ vx: 'i32', vy: 'i32' });
  /** @type {number} */ static vx;
  /** @type {number} */ static vy;
}
