// @ts-check
// Main-thread entry point of SCRAPWAKE.
import '../../engine/core/dev-global.js';
import { MainHost } from '../../engine/app/main-host.js';
import { PlatformReport } from '../../engine/app/platform-report.js';
import { WorkerUrls } from '../../engine/platform/worker-urls.js';
import { UiCommand } from '../data/ui-commands.js';
import { HUD } from '../state/hud-state.js';
import { hud, updateHud } from '../state/hud-signals.js';
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
  onReady: (e) => {
    const sw = e.swarm ? `swarm ${e.swarm.backend} ${e.swarm.units}/${e.swarm.shots}` : 'no swarm';
    const r = e.render ? `k${e.render.k}` : '';
    hud.engine.value = `${host.threading} · ${e.perfTier} · ${e.driver} · ${sw} · ${r}`;
  },
});
host.start();

// `?report[=seconds]`: measure this machine for the platform matrix (docs/engine/08-platforms.md).
const params = new URLSearchParams(location.search);
if (params.has('report')) PlatformReport.run(host, { seconds: Number(params.get('report')) || 30 });

/** Tech-demo stress keys: UI commands, so replays carry them (docs/engine/07-ui.md#state-bridge). */
/** @type {Record<string, number>} */
const STRESS_KEYS = {
  Equal: UiCommand.STRESS_UP,
  NumpadAdd: UiCommand.STRESS_UP,
  Minus: UiCommand.STRESS_DOWN,
  NumpadSubtract: UiCommand.STRESS_DOWN,
  BracketRight: UiCommand.BURST,
};
window.addEventListener('keydown', (e) => {
  const code = STRESS_KEYS[e.code];
  if (code && !e.repeat) host.command(code, 0, 0);
});
