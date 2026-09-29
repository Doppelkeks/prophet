// @ts-check
// Browser job-worker entry for jobs.spec (the Node twin is tests/support/test-job-worker.js).
import '/engine/core/dev-global.js';
import { JobWorkerLoop } from '/engine/jobs/job-worker-loop.js';
import { WorkerPorts } from '/engine/jobs/worker-port.js';
import { testRegistry } from '/tests/support/test-kernels.js';

new JobWorkerLoop(WorkerPorts.fromScope(/** @type {any} */ (self)), testRegistry()).listen();
