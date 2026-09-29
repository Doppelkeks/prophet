// @ts-check
// The tech-demo arena: a square around the origin (Q10 meters).
import { Units } from '../../engine/core/units.js';

/** Half the arena's side: 64 m. */
export const ARENA_HALF = Units.q10(64);
/** PATCH's top speed: 6.5 m/s. */
export const PATCH_SPEED = Units.q10PerTick(6.5);
