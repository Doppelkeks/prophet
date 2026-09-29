// @ts-check
import { Component } from '../../engine/ecs/component.js';

/**
 * The run's flow-field state (docs/engine/09-determinism-coop.md#async-results-at-fixed-ticks): a solve is
 * requested at tick `requested` toward cell `goal` and committed L_FIELD ticks later.
 */
export class NavField extends Component {
  static key = 'nav-field';
  static schema = /** @type {const} */ ({ goal: 'i32', requested: 'i32', pending: 'i32', committed: 'i32' });
  /** @type {number} */ static goal;
  /** @type {number} */ static requested;
  /** @type {number} */ static pending;
  /** @type {number} */ static committed;
}
