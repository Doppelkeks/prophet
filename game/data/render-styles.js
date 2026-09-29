// @ts-check
// The tech demo's look (engine/render/render-style.js): boxes in internal pixels at 8 px/m, palette tokens
// from game/ui/palette.css. Orange reads as PATCH, cyan as the Sweep (docs/game/03-art-audio.md#palette).
import { Units } from '../../engine/core/units.js';
import { ARENA_HALF } from './arena.js';

/** Actor styles, by the record's style word. */
export const ACTOR_STYLE = Object.freeze({ PATCH_BODY: 0, PATCH_HEAD: 1, PILLAR: 2, WALL_H: 3, WALL_V: 4 });

/** @type {import('../../engine/render/render-style.js').RenderStyle} */
export const RENDER_STYLE = {
  palette: '/game/ui/palette.css',
  clear: 'night-900',
  ground: { a: 'night-800', b: 'night-700', edge: 'amber-400', outside: 'night-900', tile: 2 },
  // By swarm type, in SWARM_TYPES order: Scrubber, Mite, Brute.
  units: [
    { w: 6, d: 5, h: 7, top: 'cyan-400', front: 'steel-700' },
    { w: 4, d: 3, h: 4, top: 'cyan-400', front: 'steel-500' },
    { w: 10, d: 8, h: 12, top: 'holo-100', front: 'steel-500' },
  ],
  actors: [
    { w: 6, d: 4, h: 14, top: 'rust-700', front: 'rust-700' }, // PATCH: chassis
    { w: 6, d: 4, h: 6, z: 14, top: 'concrete-400', front: 'sodium-500' }, // PATCH: head, the optic facing the camera
    { w: 32, d: 32, h: 24, top: 'concrete-400', front: 'concrete-600' }, // pillar: 4 × 4 × 3 m
    { w: 128, d: 16, h: 16, top: 'concrete-400', front: 'concrete-600' }, // wall along x: 16 × 2 × 2 m
    { w: 16, d: 128, h: 16, top: 'concrete-400', front: 'concrete-600' }, // wall along y
  ],
  shot: { w: 2, d: 1, h: 1, z: 8, top: 'sodium-500', front: 'amber-400' },
  pickup: { w: 2, d: 2, h: 2, z: 1, top: 'amber-400', front: 'rust-700' }, // scrap gems: amber (docs/game/03-art-audio.md#palette)
  stunned: 'blue-500', // stunned units show an electric-blue top
  arenaHalf: ARENA_HALF / Units.q10(1),
  lift: 1,
};
