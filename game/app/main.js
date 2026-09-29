// @ts-check
// Main-thread entry point of SCRAPWAKE.
import '../../engine/core/dev-global.js';
import { MainHost } from '../../engine/app/main-host.js';
import { WorkerUrls } from '../../engine/platform/worker-urls.js';

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('px-canvas'));
const overlay = /** @type {HTMLElement} */ (document.querySelector('px-app'));

const host = new MainHost({
  canvas,
  overlay,
  engineWorkerUrl: WorkerUrls.resolve('engine', new URL('./engine-worker.js', import.meta.url)),
});
host.start();
