// @ts-check
// The tech demo's abilities, from the part and chip designs (docs/game/02-content.md): Stomper Legs with the
// stun upgrade (the dash becomes a 3 m stomp), and a Cracked Core's Overclock with an Overclock Buffer chip
// (a 6 m knockback pulse on start). Numbers are scaled to the demo's swarm (a Scrubber has 3 HP).
import { Units } from '../../engine/core/units.js';

export const STOMP = Object.freeze({
  radius: Units.q10(3),
  damage: Units.q8(2),
  impulse: Units.q10(0.45), // per tick, decaying: about 1.8 m of slide
  tier: 1, // Stun 1 s
  cooldown: Units.ticks(3),
  source: 2,
});

/** Kill-credit source of the Arc Welder's chains (the gun is 1). */
export const ARC_SOURCE = 4;

/**
 * The director holds the next wave while the threat within 12 m of PATCH (the 3 × 3 map cells around it,
 * at T − K) is at or above this many threat points per stress level (docs/game/01-gdd.md#director).
 */
export const THREAT_CAP = 160;

export const OVERCLOCK = Object.freeze({
  duration: Units.ticks(5),
  /** Fire interval × 5/7 (+40 % fire rate) and move speed × 6/5 (+20 %) while it runs. */
  fireNum: 5,
  fireDen: 7,
  moveNum: 6,
  moveDen: 5,
  pulseRadius: Units.q10(6),
  pulseImpulse: Units.q10(0.6),
  source: 3,
  /** The meter: full at 100; +1 every 6 ticks (10 s) and +2 per kill. */
  full: 100,
  fillEvery: 6,
  perKill: 2,
});
