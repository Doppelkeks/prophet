// @ts-check
// Action maps (docs/engine/07-ui.md#input): raw input state → the quantized per-tick input record.
// This runs on the engine worker before stamping, so floats are fine here: only the quantized
// integers reach the sim and the command log.
import { InputCodes } from './input-codes.js';
import { Buttons, InputFlags, InputRecord, MOVE_MAX } from './input-record.js';

/** Gamepad buttons (standard mapping). */
export const Pad = Object.freeze({ A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 });

/** @typedef {{ keys: string[], pad: number[] }} Binding */
/** @typedef {Record<'up' | 'down' | 'left' | 'right' | 'dash' | 'build' | 'recall' | 'overclock' | 'interact' | 'pause', Binding>} Bindings */

/** @type {Bindings} */
export const DEFAULT_BINDINGS = {
  up: { keys: ['KeyW', 'ArrowUp'], pad: [Pad.UP] },
  down: { keys: ['KeyS', 'ArrowDown'], pad: [Pad.DOWN] },
  left: { keys: ['KeyA', 'ArrowLeft'], pad: [Pad.LEFT] },
  right: { keys: ['KeyD', 'ArrowRight'], pad: [Pad.RIGHT] },
  dash: { keys: ['Space', 'ShiftLeft'], pad: [Pad.A, Pad.RB] },
  build: { keys: ['KeyB'], pad: [Pad.Y] },
  recall: { keys: ['KeyR'], pad: [Pad.LB] },
  overclock: { keys: ['KeyQ'], pad: [Pad.RT] },
  interact: { keys: ['KeyE'], pad: [Pad.X] },
  pause: { keys: ['Escape', 'KeyP'], pad: [Pad.START] },
};

const DIAGONAL = Math.round(MOVE_MAX * Math.SQRT1_2);

export class ActionMap {
  static DEADZONE = 0.2;

  /** @param {Bindings} [bindings] */
  constructor(bindings = DEFAULT_BINDINGS) {
    /** @type {Record<string, { keys: number[], pad: number }>} */
    this.actions = {};
    for (const [name, b] of Object.entries(bindings)) {
      this.actions[name] = { keys: b.keys.map((k) => InputCodes.key(k)).filter((c) => c > 0), pad: b.pad.reduce((m, i) => m | (1 << i), 0) };
    }
  }

  /** @param {import('./input-state.js').InputState} s @param {string} name */
  held(s, name) {
    const a = this.actions[name];
    if (!a) return false;
    for (const k of a.keys) if (s.down(k)) return true;
    return (s.padButtons & a.pad) !== 0;
  }

  /**
   * The input record for the next tick.
   * @param {import('./input-state.js').InputState} s
   * @returns {[number, number]}
   */
  sample(s) {
    let mx = 0;
    let my = 0;
    const kx = (this.held(s, 'right') ? 1 : 0) - (this.held(s, 'left') ? 1 : 0);
    const ky = (this.held(s, 'up') ? 1 : 0) - (this.held(s, 'down') ? 1 : 0);
    if (kx || ky) {
      const m = kx && ky ? DIAGONAL : MOVE_MAX;
      mx = kx * m;
      my = ky * m;
    } else {
      [mx, my] = ActionMap.stick(s.padLX, s.padLY);
    }
    let buttons = 0;
    if (this.held(s, 'dash')) buttons |= Buttons.DASH;
    if (this.held(s, 'build')) buttons |= Buttons.BUILD;
    if (this.held(s, 'recall')) buttons |= Buttons.RECALL;
    if (this.held(s, 'overclock')) buttons |= Buttons.OVERCLOCK;
    if (this.held(s, 'interact')) buttons |= Buttons.INTERACT;
    if (this.held(s, 'pause')) buttons |= Buttons.PAUSE;
    const flags = s.device === 1 ? InputFlags.GAMEPAD : 0;
    return InputRecord.pack(mx, my, 0, buttons, flags, 0);
  }

  /**
   * A stick (i16 axes, +y down) to a quantized move with a radial deadzone, rescaled so the edge of
   * the deadzone is zero and full tilt is MOVE_MAX; +y up in the result.
   * @param {number} x @param {number} y
   * @returns {[number, number]}
   */
  static stick(x, y) {
    const fx = x / 32767;
    const fy = -y / 32767;
    const len = Math.hypot(fx, fy);
    if (len <= ActionMap.DEADZONE) return [0, 0];
    const scaled = Math.min(1, (len - ActionMap.DEADZONE) / (1 - ActionMap.DEADZONE)) / len;
    return [Math.round(fx * scaled * MOVE_MAX), Math.round(fy * scaled * MOVE_MAX)];
  }
}
