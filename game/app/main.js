// @ts-check
// Main-thread entry point of SCRAPWAKE.
import '../../engine/core/dev-global.js';
import { MainHost } from '../../engine/app/main-host.js';
import { WorkerUrls } from '../../engine/platform/worker-urls.js';
import { HUD } from '../state/hud-state.js';
import { updateHud } from '../state/hud-signals.js';
import '../ui/px-hud.js';

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('px-canvas'));
const overlay = /** @type {HTMLElement} */ (document.querySelector('px-app'));
overlay.append(document.createElement('px-hud'));

const host = new MainHost({
  canvas,
  overlay,
  engineWorkerUrl: WorkerUrls.resolve('engine', new URL('./engine-worker.js', import.meta.url)),
  hud: HUD,
  onHud: updateHud,
});
host.start();
