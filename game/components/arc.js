// @ts-check
import { Component } from '../../engine/ecs/component.js';

/**
 * A chain weapon (the Arc Welder, docs/game/02-content.md): every `interval` ticks it issues a CHAIN fire
 * command; the GPU strikes the nearest unit in range and jumps `bounces` more times, `falloff` (Q8) per jump.
 * range Q10 m, damage Q8.
 */
export class Arc extends Component {
  static key = 'arc';
  static schema = /** @type {const} */ ({ cooldown: 'i32', interval: 'i32', range: 'i32', damage: 'i32', bounces: 'u8', falloff: 'u16', source: 'u8' });
  /** @type {number} */ static cooldown;
  /** @type {number} */ static interval;
  /** @type {number} */ static range;
  /** @type {number} */ static damage;
  /** @type {number} */ static bounces;
  /** @type {number} */ static falloff;
  /** @type {number} */ static source;
}
