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
  fps: new Signal(0),
  simMs: new Signal(0),
  entities: new Signal(0),
};

/** @param {import('../../engine/ui/state-block.js').StateBlockReader} r */
export function updateHud(r) {
  hud.tick.value = r.get(I.tick);
  hud.x.value = Math.round((r.get(I.patchX) / 1024) * 10) / 10;
  hud.y.value = Math.round((r.get(I.patchY) / 1024) * 10) / 10;
  hud.fps.value = Math.round(r.get(I.fps));
  hud.simMs.value = Math.round(r.get(I.simMs) * 100) / 100;
  hud.entities.value = r.get(I.entities);
}
