// @ts-check
// The manifest of SCRAPWAKE (docs/engine/02-core-ecs-jobs.md#component-manifest): every component,
// system and job kernel. The engine worker and every job worker build a Manifest from this same
// module; a job worker whose manifest hashes differently refuses to start (manifest-mismatch).
import { Abilities, Director, Gun, Health, Motion, Pilot, RunStats, Transform } from '../components/index.js';
import { AbilitySystem } from '../systems/sim/ability-system.js';
import { AutoFireSystem } from '../systems/sim/auto-fire-system.js';
import { DirectorSystem } from '../systems/sim/director-system.js';
import { MovementSystem } from '../systems/sim/movement-system.js';
import { PilotInputSystem } from '../systems/sim/pilot-input-system.js';
import { SwarmFeedbackSystem } from '../systems/sim/swarm-feedback-system.js';
import { SwarmProxySystem } from '../systems/sim/swarm-proxy-system.js';
import { UiCommandSystem } from '../systems/sim/ui-command-system.js';

/** @type {import('../../engine/ecs/registry.js').ManifestSpec} */
export const GAME_MANIFEST = {
  components: [Transform, Motion, Pilot, Health, Gun, Abilities, RunStats, Director],
  systems: [SwarmFeedbackSystem, PilotInputSystem, UiCommandSystem, DirectorSystem, AutoFireSystem, AbilitySystem, MovementSystem, SwarmProxySystem],
  kernels: [],
};
