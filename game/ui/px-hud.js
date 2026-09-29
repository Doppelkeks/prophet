// @ts-check
// The tech-demo HUD: PATCH's position and the frame numbers. Only text nodes change per update.
import { UiElement } from '../../engine/ui/ui-element.js';
import { hud } from '../state/hud-signals.js';

const CSS = `
:host {
  position: absolute;
  inset-block-end: calc(var(--space, 8px) * 2);
  inset-inline-start: calc(var(--space, 8px) * 2);
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 13px;
  color: var(--ui-text, #e8f1ff);
  pointer-events: none;
}
.row { display: flex; gap: 12px; align-items: baseline; background: var(--ui-panel, #0b1020cc); padding: 6px 12px;
  clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px); }
.label { color: var(--ui-player, #ff8a1f); font-weight: 700; letter-spacing: 0.08em; }
.dim { color: var(--ui-text-dim, #8da2c0); }
output { font-variant-numeric: tabular-nums; min-inline-size: 5ch; text-align: end; }
`;

export class PxHud extends UiElement {
  static tag = 'px-hud';
  static styles = [CSS];
  static template = `
    <div class="row"><span class="label">PATCH</span>
      <span class="dim">x</span><output id="x"></output><span class="dim">y</span><output id="y"></output><span class="dim">m</span></div>
    <div class="row dim"><span>tick</span><output id="tick"></output><output id="fps"></output><span>fps</span>
      <span>sim</span><output id="sim"></output><span>ms</span><span>ent</span><output id="ent"></output></div>`;

  connected() {
    /** @param {string} id @param {{ value: number }} source @param {(v: number) => string} fmt */
    const text = (id, source, fmt) => {
      const el = this.$(`#${id}`);
      this.bind(source, (v) => {
        el.textContent = fmt(v);
      });
    };
    text('x', hud.x, (v) => v.toFixed(1));
    text('y', hud.y, (v) => v.toFixed(1));
    text('tick', hud.tick, String);
    text('fps', hud.fps, String);
    text('sim', hud.simMs, (v) => v.toFixed(2));
    text('ent', hud.entities, String);
  }
}
UiElement.define(PxHud);
