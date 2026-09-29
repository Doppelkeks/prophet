// @ts-check
// SCRAPWAKE as a game module (engine/app/game-module.js): what the engine worker and Node replays run.
// No DOM, GPU or clock in here.
import { Motion, Pilot, Transform } from '../components/index.js';
import { PATCH_SPEED } from '../data/arena.js';
import { HUD } from '../state/hud-state.js';
import { ARCHETYPES } from './archetypes.js';
import { GAME_MANIFEST } from './manifest.js';

const I = HUD.index;

/** @type {import('../../engine/app/game-module.js').GameModule} */
export const SCRAPWAKE = {
  manifest: GAME_MANIFEST,
  hud: HUD,

  setup(sim) {
    const world = sim.world;
    if (world.archetype([Transform, Motion, Pilot]) !== ARCHETYPES.pilot) throw new Error('archetype order changed');
    const patch = world.spawn(ARCHETYPES.pilot);
    world.set(patch, Pilot.speed, PATCH_SPEED);
    sim.resources.patch = patch;
  },

  extract(sim, hud, frame) {
    const world = sim.world;
    const patch = sim.resources.patch;
    hud.set(I.tick, sim.tick);
    hud.set(I.patchX, world.get(patch, Transform.x));
    hud.set(I.patchY, world.get(patch, Transform.y));
    hud.set(I.fps, frame.fps);
    hud.set(I.frameMs, frame.frameMs);
    hud.set(I.simMs, frame.simMs);
    hud.set(I.ticks, frame.ticks);
    hud.set(I.skipped, frame.skipped);
    hud.set(I.entities, world.size);
  },
};
