// Node job worker for the ECS tests: the same sample manifest as the engine side, plus an ECS
// environment per thread, so chunk-parallel systems can run here.
import '../../engine/core/dev-global.js';
import { parentPort } from 'node:worker_threads';
import { JobWorkerLoop } from '../../engine/jobs/job-worker-loop.js';
import { WorkerPorts } from '../../engine/jobs/worker-port.js';
import { Manifest } from '../../engine/ecs/registry.js';
import { EcsEnv } from '../../engine/ecs/ecs-env.js';
import { SAMPLE_MANIFEST } from './ecs-sample.js';

if (!parentPort) throw new Error('ecs-job-worker must run in a worker thread');
const manifest = new Manifest(SAMPLE_MANIFEST);
new JobWorkerLoop(WorkerPorts.fromNode(parentPort), manifest.kernels, (heap, participant) => new EcsEnv(heap, manifest, participant)).listen();
