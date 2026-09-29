// @ts-check
// Engine-worker entry point of SCRAPWAKE: simulation and WebGPU live here.
import '../../engine/core/dev-global.js';
import { EngineHost } from '../../engine/app/engine-host.js';

new EngineHost(/** @type {import('../../engine/app/engine-host.js').WorkerScope} */ (/** @type {unknown} */ (self)));
