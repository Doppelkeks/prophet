// @ts-check
// The tech-demo HUD (docs/engine/07-ui.md#combat-hud-rules): HP bar, kills, the swarm, frame numbers.
// Only text nodes and one transform change per update, so nothing here causes layout.
import { UiElement } from '../../engine/ui/ui-element.js';
import { hud } from '../state/hud-signals.js';

const CSS = `
:host {
  position: absolute;
  inset: auto auto calc(var(--space, 8px) * 2) calc(var(--space, 8px) * 2);
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 13px;
  color: var(--ui-text, #e8f1ff);
  pointer-events: none;
  min-inline-size: 280px;
}
.row {
  display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap;
  background: var(--ui-panel, #0b1020cc); padding: 6px 12px;
  clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px);
}
.label { color: var(--ui-player, #ff8a1f); font-weight: 700; letter-spacing: 0.08em; }
.enemy { color: var(--ui-enemy, #3de0ff); font-weight: 700; letter-spacing: 0.08em; }
.dim { color: var(--ui-text-dim, #8da2c0); }
.scrap { color: var(--ui-accent, #ffb23f); font-weight: 700; letter-spacing: 0.08em; }
.danger { color: var(--ui-danger, #e8431c); font-weight: 700; }
.energy .fill { background: var(--ui-accent, #ffb23f); }
output { font-variant-numeric: tabular-nums; }
.bar { flex: 1 1 120px; block-size: 8px; background: #ffffff1a; position: relative; overflow: hidden; }
.fill { position: absolute; inset: 0; background: var(--ui-player, #ff8a1f); transform-origin: left center; }
`;

export class PxHud extends UiElement {
  static tag = 'px-hud';
  static styles = [CSS];
  static template = `
    <div class="row"><span class="label">PATCH</span><div class="bar"><div class="fill"></div></div><output id="hp"></output>
      <span class="scrap">SCRAP</span><output id="scrap"></output>
      <span class="dim">x</span><output id="x"></output><span class="dim">y</span><output id="y"></output></div>
    <div class="row"><span class="enemy">SWARM</span><output id="alive"></output><span class="dim">alive</span>
      <output id="kills"></output><span class="dim">kills</span><span class="dim">wave</span><output id="waves"></output>
      <span class="dim">downs</span><output id="downs"></output>
      <span class="dim">elites</span><output id="elites"></output>
      <span class="dim">threat</span><output id="threat"></output>
      <span class="dim">stress</span><output id="stress"></output><span class="dim">shots</span><output id="shots"></output>
      <span class="dim">rejected</span><output id="rejected"></output></div>
    <div class="row"><span class="label">CORE</span><div class="bar energy"><div class="fill"></div></div><output id="energy"></output>
      <span class="dim">[Q]</span><output id="oc"></output><span class="dim">[Space] stomp</span><output id="stomp"></output>
      <output id="taint" class="danger"></output></div>
    <div class="row dim"><span>tick</span><output id="tick"></output><output id="fps"></output><span>fps</span>
      <span>sim</span><output id="sim"></output><span>ms</span><span>stalls</span><output id="stalls"></output>
      <span>rb95</span><output id="rb"></output><span>gpu95</span><output id="gpu"></output></div>
    <div class="row dim"><output id="engine"></output><span>[=] [−] stress · []] burst</span></div>`;

  connected() {
    /** @template T @param {string} id @param {{ value: T }} source @param {(v: T) => string} fmt */
    const text = (id, source, fmt) => {
      const el = this.$(`#${id}`);
      this.bind(source, (v) => {
        el.textContent = fmt(v);
      });
    };
    const fill = /** @type {HTMLElement} */ (this.$('.fill'));
    this.bind(hud.hpRatio, (r) => {
      fill.style.transform = `scaleX(${r})`;
    });
    const energy = /** @type {HTMLElement} */ (this.$('.energy .fill'));
    this.bind(hud.energy, (e) => {
      energy.style.transform = `scaleX(${e / 100})`;
    });
    text('hp', hud.hp, String);
    text('scrap', hud.scrap, String);
    text('energy', hud.energy, (e) => `${e}%`);
    text('oc', hud.overclock, (s) => (s > 0 ? `OVERCLOCK ${s.toFixed(1)} s` : 'overclock'));
    text('stomp', hud.stomp, (s) => (s > 0 ? `${s.toFixed(1)} s` : 'ready'));
    text('elites', hud.elites, String);
    text('threat', hud.threat, String);
    text('taint', hud.taints, (n) => (n > 0 ? `events lost ×${n}: replay tainted` : ''));
    text('x', hud.x, (v) => v.toFixed(1));
    text('y', hud.y, (v) => v.toFixed(1));
    text('alive', hud.alive, String);
    text('kills', hud.kills, String);
    text('waves', hud.waves, String);
    text('downs', hud.downs, String);
    text('tick', hud.tick, String);
    text('fps', hud.fps, String);
    text('sim', hud.simMs, (v) => v.toFixed(2));
    text('stalls', hud.stalls, String);
    text('rb', hud.readbackP95, (v) => v.toFixed(1));
    text('gpu', hud.swarmGpuP95, (v) => (v > 0 ? v.toFixed(2) : '–'));
    text('stress', hud.stress, String);
    text('shots', hud.shots, String);
    text('rejected', hud.rejected, String);
    text('engine', hud.engine, String);
  }
}
UiElement.define(PxHud);
