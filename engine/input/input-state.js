// @ts-check
// Engine-side view of the raw input: key bitset, pointer, wheel and gamepad state, rebuilt from the
// input-ring records every frame.
import { UI_MAX, UI_WORDS } from './command-log.js';
import { InputKind } from './input-ring.js';

export class InputState {
  constructor() {
    this.keys = new Uint32Array(4);
    this.pointerX = 0;
    this.pointerY = 0;
    this.pointerButtons = 0;
    this.wheel = 0;
    /** Gamepad sticks as i16 (-32767..32767, +y down as reported by the Gamepad API). */
    this.padLX = 0;
    this.padLY = 0;
    this.padRX = 0;
    this.padRY = 0;
    this.padButtons = 0;
    /** Last device used: 0 keyboard and mouse, 1 gamepad. */
    this.device = 0;
    /** UI commands waiting for the next stamped tick: `UI_WORDS` each (code, a, b). */
    this.ui = new Uint32Array(UI_MAX * UI_WORDS);
    this.uiCount = 0;
    /** UI commands lost because more than UI_MAX arrived before a tick was stamped. */
    this.uiDropped = 0;
  }

  /** Applies one ring record. @param {number} kind @param {number} a @param {number} b @param {number} c */
  apply(kind, a, b, c) {
    switch (kind) {
      case InputKind.KEY:
        if (a > 0 && a < 128) {
          if (b) this.keys[a >>> 5] |= 1 << (a & 31);
          else this.keys[a >>> 5] &= ~(1 << (a & 31));
          this.device = 0;
        }
        break;
      case InputKind.POINTER:
        this.pointerX = a;
        this.pointerY = b;
        this.pointerButtons = c;
        this.device = 0;
        break;
      case InputKind.BUTTON:
        if (b) this.pointerButtons |= 1 << a;
        else this.pointerButtons &= ~(1 << a);
        this.device = 0;
        break;
      case InputKind.WHEEL:
        this.wheel += a;
        break;
      case InputKind.GAMEPAD:
        this.padLX = (a << 16) >> 16;
        this.padLY = a >> 16;
        this.padRX = (b << 16) >> 16;
        this.padRY = b >> 16;
        if (c !== this.padButtons || a !== 0 || b !== 0) this.device = 1;
        this.padButtons = c;
        break;
      case InputKind.UI:
        if (this.uiCount < UI_MAX) {
          const o = this.uiCount * UI_WORDS;
          this.ui[o] = a;
          this.ui[o + 1] = b;
          this.ui[o + 2] = c;
          this.uiCount++;
        } else {
          this.uiDropped++;
        }
        break;
      case InputKind.BLUR:
        this.keys.fill(0);
        this.pointerButtons = 0;
        this.padButtons = 0;
        this.padLX = this.padLY = this.padRX = this.padRY = 0;
        break;
    }
  }

  /** @param {number} code */
  down(code) {
    return (this.keys[code >>> 5] & (1 << (code & 31))) !== 0;
  }

  /** Wheel movement since the last call. */
  takeWheel() {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }
}
