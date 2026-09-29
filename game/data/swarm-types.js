// @ts-check
// Tech-demo swarm types (docs/game/02-content.md#enemies has the real roster). Converted at load time.
import { Units } from '../../engine/core/units.js';
import { UnitFlag } from '../../engine/swarm/swarm-contract.js';

/** @type {(import('../../engine/swarm/swarm-contract.js').UnitType & { name: string })[]} */
export const SWARM_TYPES = [
  { name: 'Scrubber', speed: Units.q10PerTick(3.2), radius: Units.q10(0.35), maxHp: Units.q8(3), contact: Units.q8(1), interval: 30, dropChance: Units.q16(0.35), dropValue: 1 },
  { name: 'Mite', speed: Units.q10PerTick(4.8), radius: Units.q10(0.25), maxHp: Units.q8(1), contact: Units.q8(0.5), interval: 20, dropChance: Units.q16(0.2), dropValue: 1 },
  // Brutes are the demo's elites: heavy (they keep 3/8 of any knockback) and their deaths are reported as events.
  { name: 'Brute', speed: Units.q10PerTick(2.0), radius: Units.q10(0.6), maxHp: Units.q8(12), contact: Units.q8(3), interval: 45, dropChance: Units.q16(1), dropValue: 5, knockback: 160, flags: UnitFlag.REPORT },
];

/** Steps of STATUS_STEP (4) ticks: 15 steps = 1 s. Damage per step in Q8 HP (docs/engine/05-gpu-swarm.md#status-effects). */
const s = (/** @type {number} */ seconds) => Math.round((seconds * 60) / 4);

/** @type {import('../../engine/swarm/swarm-contract.js').StatusSpec[]} by Status index, tiers 1..3 */
export const SWARM_STATUSES = [
  { durations: [s(1), s(2), s(3)], damage: Units.q8(0.5) }, // burning
  { durations: [s(1), s(2), s(3)], damage: Units.q8(0.25) }, // shocked
  { durations: [s(2), s(3), s(4)] }, // slowed
  { durations: [s(1), s(1.5), s(2)] }, // stunned (EMP: 1 s for fodder)
  { durations: [s(3), s(5), s(8)] }, // marked
  { durations: [s(2), s(3), s(4)], damage: Units.q8(0.25) }, // corroded
  { durations: [s(1), s(2), s(3)] }, // magnetized
  { durations: [s(2), s(2), s(2)] }, // overheated
];

/** @type {Record<string, Partial<import('../../engine/swarm/swarm-layout.js').SwarmCaps>>} pool sizes per heap profile (docs/BUDGETS.md#entity-caps) */
export const SWARM_CAPS = {
  high: { units: 100000, shots: 50000, pickups: 16384, effects: 256, events: 8192 },
  std: { units: 40000, shots: 20000, pickups: 8192, effects: 256, events: 4096 },
  test: { units: 2048, shots: 512, pickups: 512, effects: 256, events: 256 },
};
