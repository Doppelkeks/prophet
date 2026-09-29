// Node job-worker entry for the unit tests (the browser twin is tests/browser/pages/jobs-worker.js).
// workerData.stale = true imports an out-of-date kernel list, which the engine must refuse.
import '../../engine/core/dev-global.js';
import { parentPort, workerData } from 'node:worker_threads';
import { JobWorkerLoop } from '../../engine/jobs/job-worker-loop.js';
import { WorkerPorts } from '../../engine/jobs/worker-port.js';
import { staleRegistry, testRegistry } from './test-kernels.js';

if (!parentPort) throw new Error('test-job-worker must run in a worker thread');
new JobWorkerLoop(WorkerPorts.fromNode(parentPort), workerData?.stale ? staleRegistry() : testRegistry()).listen();
