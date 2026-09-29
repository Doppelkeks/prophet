// @ts-check
import { Component } from '../../engine/ecs/component.js';

/** Hit points in Q8 (256 = 1 HP). */
export class Health extends Component {
  static key = 'health';
  static schema = /** @type {const} */ ({ hp: 'i32', max: 'i32' });
  /** @type {number} */ static hp;
  /** @type {number} */ static max;
}
