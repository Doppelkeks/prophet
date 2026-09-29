// @ts-check
import { Component } from '../../engine/ecs/component.js';

/** World position in Q10 meters (1/1024 m). x = east, y = north (up on screen), z = height. */
export class Transform extends Component {
  static key = 'transform';
  static schema = /** @type {const} */ ({ x: 'i32', y: 'i32', z: 'i32' });
  /** @type {number} */ static x;
  /** @type {number} */ static y;
  /** @type {number} */ static z;
}
