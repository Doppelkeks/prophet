// @ts-check
// Tech-demo swarm types (docs/game/02-content.md#enemies has the real roster). Converted at load time.
import { Units } from '../../engine/core/units.js';

/** @type {(import('../../engine/swarm/swarm-contract.js').UnitType & { name: string })[]} */
export const SWARM_TYPES = [
  { name: 'Scrubber', speed: Units.q10PerTick(3.2), radius: Units.q10(0.35), maxHp: Units.q8(3), contact: Units.q8(1), interval: 30, dropChance: Units.q16(0.35), dropValue: 1 },
  { name: 'Mite', speed: Units.q10PerTick(4.8), radius: Units.q10(0.25), maxHp: Units.q8(1), contact: Units.q8(0.5), interval: 20, dropChance: Units.q16(0.2), dropValue: 1 },
  { name: 'Brute', speed: Units.q10PerTick(2.0), radius: Units.q10(0.6), maxHp: Units.q8(12), contact: Units.q8(3), interval: 45, dropChance: Units.q16(1), dropValue: 5 },
];

/** @type {Record<string, { units: number, shots: number, pickups: number }>} pool sizes per heap profile (docs/BUDGETS.md#entity-caps) */
export const SWARM_CAPS = {
  high: { units: 100000, shots: 50000, pickups: 16384 },
  std: { units: 40000, shots: 20000, pickups: 8192 },
  test: { units: 2048, shots: 512, pickups: 512 },
};
