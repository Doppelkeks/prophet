// @ts-check
// HUD signals, fed from the UI state block by the main host (≤ 30 Hz). Elements bind to these.
import { Signal } from '../../engine/ui/signal.js';
import { HUD } from './hud-state.js';

const I = HUD.index;

export const hud = {
  tick: new Signal(0),
  /** PATCH position in meters, rounded to 0.1 m. */
  x: new Signal(0),
  y: new Signal(0),
  /** HP as a 0..1 ratio and as whole points. */
  hpRatio: new Signal(/** @type {number} */ (1), Signal.near(0.002)),
  hp: new Signal(0),
  scrap: new Signal(0),
  kills: new Signal(0),
  alive: new Signal(0),
  shots: new Signal(0),
  waves: new Signal(0),
  downs: new Signal(0),
  stalls: new Signal(0),
  fps: new Signal(0),
  simMs: new Signal(0),
  readbackP95: new Signal(0),
  stress: new Signal(0),
  rejected: new Signal(0),
  /** Threading tier, performance tier, frame driver, swarm backend and pools, scale (set once at boot). */
  engine: new Signal(''),
};

/** @param {import('../../engine/ui/state-block.js').StateBlockReader} r */
export function updateHud(r) {
  const max = r.get(I.hpMax) || 1;
  hud.tick.value = r.get(I.tick);
  hud.x.value = Math.round((r.get(I.patchX) / 1024) * 10) / 10;
  hud.y.value = Math.round((r.get(I.patchY) / 1024) * 10) / 10;
  hud.hpRatio.value = Math.max(0, Math.min(1, r.get(I.hp) / max));
  hud.hp.value = Math.ceil(r.get(I.hp) / 256);
  hud.scrap.value = r.get(I.scrap);
  hud.kills.value = r.get(I.kills);
  hud.alive.value = r.get(I.alive);
  hud.shots.value = r.get(I.shots);
  hud.waves.value = r.get(I.waves);
  hud.downs.value = r.get(I.downs);
  hud.stalls.value = r.get(I.stalls);
  hud.fps.value = Math.round(r.get(I.fps));
  hud.simMs.value = Math.round(r.get(I.simMs) * 100) / 100;
  hud.readbackP95.value = Math.round(r.get(I.readbackP95) * 10) / 10;
  hud.stress.value = r.get(I.stress);
  hud.rejected.value = r.get(I.rejected);
}
