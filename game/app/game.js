// @ts-check
// SCRAPWAKE as a game module (engine/app/game-module.js): what the engine worker and Node replays run.
// No DOM, GPU or clock in here.
import { Units } from '../../engine/core/units.js';
import { Director, Gun, Health, Motion, Pilot, RunStats, Transform } from '../components/index.js';
import { PATCH_SPEED } from '../data/arena.js';
import { SWARM_CAPS, SWARM_TYPES } from '../data/swarm-types.js';
import { HUD } from '../state/hud-state.js';
import { ARCHETYPES } from './archetypes.js';
import { GAME_MANIFEST } from './manifest.js';

const I = HUD.index;

/** @type {import('../../engine/app/game-module.js').GameModule} */
export const SCRAPWAKE = {
  manifest: GAME_MANIFEST,
  hud: HUD,
  swarm: {
    K: 4, // docs/BUDGETS.md#simulation-constants
    seed: 0x5c4a9,
    types: SWARM_TYPES,
    caps: (profile) => SWARM_CAPS[profile] ?? SWARM_CAPS.std,
  },

  setup(sim) {
    const world = sim.world;
    if (world.archetype([Transform, Motion, Pilot, Health, Gun]) !== ARCHETYPES.pilot) throw new Error('archetype order changed');
    if (world.archetype([RunStats, Director]) !== ARCHETYPES.run) throw new Error('archetype order changed');
    const patch = world.spawn(ARCHETYPES.pilot);
    world.set(patch, Pilot.speed, PATCH_SPEED);
    world.add(patch, Health, [Units.q8(100), Units.q8(100)]);
    world.add(patch, Gun, [0, Units.ticks(0.1), Units.q10(14), Units.q8(1.5), Units.q10PerTick(30), Units.ticks(0.7), 1, 0]);
    const run = world.spawn(ARCHETYPES.run);
    world.add(run, Director, [Units.ticks(1), Units.ticks(1.5), 24, 6, 20000, Units.q10(18), Units.q10(24), 0]);
    sim.resources.patch = patch;
    sim.resources.run = run;
  },

  extract(sim, hud, frame) {
    const world = sim.world;
    const patch = sim.resources.patch;
    const run = sim.resources.run;
    hud.set(I.tick, sim.tick);
    hud.set(I.patchX, world.get(patch, Transform.x));
    hud.set(I.patchY, world.get(patch, Transform.y));
    hud.set(I.hp, world.get(patch, Health.hp));
    hud.set(I.hpMax, world.get(patch, Health.max));
    hud.set(I.kills, world.get(run, RunStats.kills));
    hud.set(I.alive, world.get(run, RunStats.alive));
    hud.set(I.shots, world.get(run, RunStats.shots));
    hud.set(I.waves, world.get(run, RunStats.waves));
    hud.set(I.downs, world.get(run, RunStats.downs));
    hud.set(I.rejected, world.get(run, RunStats.rejected));
    hud.set(I.stalls, sim.stalls);
    hud.set(I.stress, world.get(run, Director.stress));
    hud.set(I.fps, frame.fps);
    hud.set(I.frameMs, frame.frameMs);
    hud.set(I.simMs, frame.simMs);
    hud.set(I.ticks, frame.ticks);
    hud.set(I.skipped, frame.skipped);
    hud.set(I.entities, world.size);
    hud.set(I.readbackP95, frame.readbackP95 ?? 0);
  },
};
