// @ts-check
// Job-worker entry point of SCRAPWAKE (docs/engine/02-core-ecs-jobs.md#workers-and-waiting).
// The engine worker spawns these; they run kernels from the shared job queue or on transferred buffers.
import '../../engine/core/dev-global.js';
import { JobWorkerLoop } from '../../engine/jobs/job-worker-loop.js';
import { KernelRegistry } from '../../engine/jobs/kernel.js';
import { WorkerPorts } from '../../engine/jobs/worker-port.js';
import { GAME_KERNELS } from './kernels.js';

const scope = /** @type {Parameters<typeof WorkerPorts.fromScope>[0]} */ (/** @type {unknown} */ (self));
new JobWorkerLoop(WorkerPorts.fromScope(scope), new KernelRegistry(GAME_KERNELS)).listen();
