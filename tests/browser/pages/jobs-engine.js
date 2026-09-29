// @ts-check
// Engine-like worker for jobs.spec: creates a heap and a job system with nested job workers, runs the
// job scenario, and reports its hash.
import '/engine/core/dev-global.js';
import { Heap } from '/engine/core/heap.js';
import { JobSystem } from '/engine/jobs/job-system.js';
import { WorkerPorts } from '/engine/jobs/worker-port.js';
import { testRegistry } from '/tests/support/test-kernels.js';
import { JobScenario } from '/tests/support/job-scenario.js';

const JOB_WORKER = new URL('./jobs-worker.js', import.meta.url);
const scope = /** @type {any} */ (self);

scope.onmessage = async (/** @type {MessageEvent} */ e) => {
  const { id, tier, workers } = e.data;
  const coi = scope.crossOriginIsolated;
  try {
    const heap = Heap.create('test', tier === 'shared');
    /** @type {string[]} */
    const jobErrors = [];
    const jobs = await JobSystem.create({
      tier,
      heap,
      registry: testRegistry(),
      workers,
      spawn: (i) => WorkerPorts.spawnBrowser(JOB_WORKER, `px-job-${i}`),
      onJobError: (job, key, err) => jobErrors.push(`${key}: ${err}`),
    });
    try {
      const t0 = performance.now();
      const hash = await JobScenario.run(jobs);
      scope.postMessage({ id, hash, coi, shared: heap.shared, ms: performance.now() - t0, jobErrors });
    } finally {
      await jobs.shutdown();
    }
  } catch (err) {
    scope.postMessage({ id, error: err instanceof Error ? err.message : String(err), coi });
  }
};
