// @ts-check
// The tech-demo arena: a square around the origin (Q10 meters).
import { Units } from '../../engine/core/units.js';

/** Half the arena's side: 64 m. */
export const ARENA_HALF = Units.q10(64);
/** PATCH's top speed: 6.5 m/s. */
export const PATCH_SPEED = Units.q10PerTick(6.5);
/** PATCH's body radius for the swarm (push and contact): 0.5 m. */
export const PATCH_RADIUS = Units.q10(0.5);
/** PATCH's pickup (magnet) radius: scrap gems inside it fly to PATCH. 3 m before parts and chips. */
export const PATCH_MAGNET = Units.q10(3);

/**
 * The nav grid is the swarm's bin grid (docs/BUDGETS.md#world-constants): 128 × 128 cells of 2 m, centered on
 * the origin. The swarm layout must match (SCRAPWAKE.swarm.cost checks it).
 */
export const NAV = Object.freeze({ w: 128, shift: 11, origin: -(128 << 11) >> 1 });
/** Flow-field commit lag and re-solve spacing: L_field (docs/BUDGETS.md#simulation-constants). */
export const L_FIELD = 15;

/**
 * Indestructible obstacles, in meters: lower-left corner and size, on the 2 m grid. Eight pillars around the
 * start and four walls further out. (Destructible voxel buildings replace them in M3.)
 * @type {readonly { x: number, y: number, w: number, h: number, kind: 'pillar' | 'wallH' | 'wallV' }[]}
 */
export const OBSTACLES = Object.freeze([
  ...[[24, 0], [-24, 0], [0, 24], [0, -24], [18, 18], [-18, 18], [18, -18], [-18, -18]].map(([cx, cy]) => ({ x: cx - 2, y: cy - 2, w: 4, h: 4, kind: /** @type {const} */ ('pillar') })),
  { x: -8, y: 40, w: 16, h: 2, kind: 'wallH' },
  { x: -8, y: -42, w: 16, h: 2, kind: 'wallH' },
  { x: 40, y: -8, w: 2, h: 16, kind: 'wallV' },
  { x: -42, y: -8, w: 2, h: 16, kind: 'wallV' },
]);

/** The nav cost grid: 0 blocked, 1 open (docs/engine/06-world.md#navigation). Built once, shared by every thread. */
export const ARENA_COST = (() => {
  const cost = new Uint8Array(NAV.w * NAV.w).fill(1);
  const half = NAV.w >> 1; // cell of 0 m
  for (const o of OBSTACLES) {
    for (let y = (o.y >> 1) + half; y < ((o.y + o.h) >> 1) + half; y++) {
      for (let x = (o.x >> 1) + half; x < ((o.x + o.w) >> 1) + half; x++) cost[y * NAV.w + x] = 0;
    }
  }
  return cost;
})();

/** The nav cell of a position (Q10), clamped to the grid. @param {number} x @param {number} y */
export function navCell(x, y) {
  const last = NAV.w - 1;
  let cx = (x - NAV.origin) >> NAV.shift;
  let cy = (y - NAV.origin) >> NAV.shift;
  cx = cx < 0 ? 0 : cx > last ? last : cx;
  cy = cy < 0 ? 0 : cy > last ? last : cy;
  return Math.imul(cy, NAV.w) + cx;
}
