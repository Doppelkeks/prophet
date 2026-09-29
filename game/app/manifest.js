// @ts-check
// The manifest of SCRAPWAKE (docs/engine/02-core-ecs-jobs.md#component-manifest): every component,
// system and job kernel. The engine worker and every job worker build a Manifest from this same
// module; a job worker whose manifest hashes differently refuses to start (manifest-mismatch).
import { Motion, Pilot, Transform } from '../components/index.js';
import { MovementSystem } from '../systems/sim/movement-system.js';
import { PilotInputSystem } from '../systems/sim/pilot-input-system.js';

/** @type {import('../../engine/ecs/registry.js').ManifestSpec} */
export const GAME_MANIFEST = {
  components: [Transform, Motion, Pilot],
  systems: [PilotInputSystem, MovementSystem],
  kernels: [],
};
