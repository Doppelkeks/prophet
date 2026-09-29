// @ts-check
// Job-worker entry point of SCRAPWAKE (docs/engine/02-core-ecs-jobs.md#workers-and-waiting).
// The engine worker spawns these. They run kernels from the shared job queue (including chunk-parallel
// ECS systems, through a per-thread EcsEnv) or on transferred buffers.
import '../../engine/core/dev-global.js';
import { EcsEnv } from '../../engine/ecs/ecs-env.js';
import { Manifest } from '../../engine/ecs/registry.js';
import { JobWorkerLoop } from '../../engine/jobs/job-worker-loop.js';
import { WorkerPorts } from '../../engine/jobs/worker-port.js';
import { GAME_MANIFEST } from './manifest.js';

const scope = /** @type {Parameters<typeof WorkerPorts.fromScope>[0]} */ (/** @type {unknown} */ (self));
const manifest = new Manifest(GAME_MANIFEST);
new JobWorkerLoop(WorkerPorts.fromScope(scope), manifest.kernels, (heap, participant) => new EcsEnv(heap, manifest, participant)).listen();
