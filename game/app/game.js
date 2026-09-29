// @ts-check
// SCRAPWAKE as a game module (engine/app/game-module.js): what the engine worker and Node replays run.
// No DOM, GPU or clock in here.
import { Units } from '../../engine/core/units.js';
import { ACTOR_WORDS } from '../../engine/render/render-style.js';
import { FlowField } from '../../engine/nav/sim/flow-field.js';
import { Abilities, Arc, Director, Gun, Health, Motion, NavField, Pilot, RunStats, Transform } from '../components/index.js';
import { ARENA_COST, L_FIELD, NAV, OBSTACLES, PATCH_SPEED } from '../data/arena.js';
import { ACTOR_STYLE, RENDER_STYLE } from '../data/render-styles.js';
import { ARC_SOURCE } from '../data/abilities.js';
import { SWARM_CAPS, SWARM_STATUSES, SWARM_TYPES } from '../data/swarm-types.js';
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
    statuses: SWARM_STATUSES,
    cost(layout) {
      const L = layout.L;
      if (L.gridW !== NAV.w || L.cellShift !== NAV.shift || L.originX !== NAV.origin || L.originY !== NAV.origin) {
        throw new Error('SCRAPWAKE: the swarm bin grid must be the nav grid (128 × 128 cells of 2 m, centered)');
      }
      return ARENA_COST;
    },
    caps: (profile) => SWARM_CAPS[profile] ?? SWARM_CAPS.std,
  },
  render: {
    style: RENDER_STYLE,
    actors(sim, out) {
      const world = sim.world;
      const patch = sim.resources.patch;
      const x = world.get(patch, Transform.x);
      const y = world.get(patch, Transform.y);
      const z = world.get(patch, Transform.z);
      const vx = world.get(patch, Motion.vx);
      const vy = world.get(patch, Motion.vy);
      // PATCH as two boxes; the camera follows the first record.
      for (let i = 0; i < 2; i++) {
        const r = i * ACTOR_WORDS;
        out[r] = x;
        out[r + 1] = y;
        out[r + 2] = z;
        out[r + 3] = vx;
        out[r + 4] = vy;
        out[r + 5] = i === 0 ? ACTOR_STYLE.PATCH_BODY : ACTOR_STYLE.PATCH_HEAD;
      }
      // The obstacles: static boxes centered on their rectangles.
      for (let k = 0; k < OBSTACLES.length; k++) {
        const o = OBSTACLES[k];
        const r = (2 + k) * ACTOR_WORDS;
        out[r] = (o.x * 2 + o.w) << 9; // center, Q10: (x + w / 2) m
        out[r + 1] = (o.y * 2 + o.h) << 9;
        out[r + 2] = 0;
        out[r + 3] = 0;
        out[r + 4] = 0;
        out[r + 5] = o.kind === 'pillar' ? ACTOR_STYLE.PILLAR : o.kind === 'wallH' ? ACTOR_STYLE.WALL_H : ACTOR_STYLE.WALL_V;
      }
      return 2 + OBSTACLES.length;
    },
  },

  setup(sim) {
    const world = sim.world;
    if (world.archetype([Transform, Motion, Pilot, Health, Gun, Abilities, Arc]) !== ARCHETYPES.pilot) throw new Error('archetype order changed');
    if (world.archetype([RunStats, Director, NavField]) !== ARCHETYPES.run) throw new Error('archetype order changed');
    const patch = world.spawn(ARCHETYPES.pilot);
    world.set(patch, Pilot.speed, PATCH_SPEED);
    world.add(patch, Health, [Units.q8(100), Units.q8(100)]);
    world.add(patch, Gun, [0, Units.ticks(0.1), Units.q10(14), Units.q8(1.5), Units.q10PerTick(30), Units.ticks(0.7), 1, 0]);
    // The Arc Welder: 1.4 chains a second over 8 m, jumping to 2 more targets at −30 % each.
    world.add(patch, Arc, [0, Units.ticks(1 / 1.4), Units.q10(8), Units.q8(2), 2, Units.q12(0.7) >> 4, ARC_SOURCE]);
    const run = world.spawn(ARCHETYPES.run);
    // The director never asks for more units than the pool holds (the replay header records the pool).
    const pool = sim.swarm ? sim.swarm.backend.layout.caps.units : 20000;
    world.add(run, Director, [Units.ticks(1), Units.ticks(1.5), 24, 6, Math.min(20000, pool), Units.q10(18), Units.q10(24), 0]);
    world.add(run, NavField, [-1, -L_FIELD, 0, -1]); // no goal yet: the first request goes out on tick 0
    sim.resources.patch = patch;
    sim.resources.run = run;
    sim.resources.flow = new FlowField(NAV.w, NAV.w); // the solver's scratch; the field it commits is sim state
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
    hud.set(I.scrap, world.get(run, RunStats.scrap));
    hud.set(I.energy, world.get(patch, Abilities.energy));
    hud.set(I.overclock, world.get(patch, Abilities.overclock));
    hud.set(I.stompCd, world.get(patch, Abilities.stompCd));
    hud.set(I.elites, world.get(run, RunStats.elites));
    hud.set(I.taints, sim.taints);
    hud.set(I.threat, world.get(run, RunStats.threat));
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
