// @ts-check
import { Component } from '../../engine/ecs/component.js';

/**
 * An auto-firing weapon: every `interval` ticks it issues a fire command, and the GPU picks the target.
 * range Q10 m, damage Q8, shot speed Q10 m per tick, lifetime in ticks.
 */
export class Gun extends Component {
  static key = 'gun';
  static schema = /** @type {const} */ ({ cooldown: 'i32', interval: 'i32', range: 'i32', damage: 'i32', speed: 'u16', life: 'u16', pierce: 'u8', source: 'u8' });
  /** @type {number} */ static cooldown;
  /** @type {number} */ static interval;
  /** @type {number} */ static range;
  /** @type {number} */ static damage;
  /** @type {number} */ static speed;
  /** @type {number} */ static life;
  /** @type {number} */ static pierce;
  /** @type {number} */ static source;
}
