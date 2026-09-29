// @ts-check
// Engine-worker entry point of SCRAPWAKE: simulation and WebGPU live here.
import '../../engine/core/dev-global.js';
import { EngineHost } from '../../engine/app/engine-host.js';
import { WorkerUrls } from '../../engine/platform/worker-urls.js';
import { SCRAPWAKE } from './game.js';

new EngineHost(/** @type {import('../../engine/app/engine-host.js').WorkerScope} */ (/** @type {unknown} */ (self)), {
  game: SCRAPWAKE,
  jobWorkerUrl: WorkerUrls.resolve('job', new URL('./job-worker.js', import.meta.url)),
});
