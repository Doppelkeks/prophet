// Node job worker running SCRAPWAKE's manifest (the browser entry is game/app/job-worker.js).
import '../../engine/core/dev-global.js';
import { parentPort } from 'node:worker_threads';
import { EcsEnv } from '../../engine/ecs/ecs-env.js';
import { Manifest } from '../../engine/ecs/registry.js';
import { JobWorkerLoop } from '../../engine/jobs/job-worker-loop.js';
import { WorkerPorts } from '../../engine/jobs/worker-port.js';
import { GAME_MANIFEST } from '../../game/app/manifest.js';

if (!parentPort) throw new Error('game-job-worker must run in a worker thread');
const manifest = new Manifest(GAME_MANIFEST);
new JobWorkerLoop(WorkerPorts.fromNode(parentPort), manifest.kernels, (heap, participant) => new EcsEnv(heap, manifest, participant)).listen();
