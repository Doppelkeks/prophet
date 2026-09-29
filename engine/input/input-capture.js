// @ts-check
// Main-thread input capture (docs/engine/07-ui.md#input): DOM events and a once-per-frame gamepad poll,
// written as compact records into the input ring. Only the engine interprets them.
import { InputCodes } from './input-codes.js';
import { InputKind } from './input-ring.js';

/** Keys whose browser default (scrolling, focus moves, find-as-you-type) we suppress while playing. */
const SUPPRESS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Backquote', 'Quote', 'Slash']);

export class InputCapture {
  /**
   * @param {import('./input-ring.js').InputRing} ring
   * @param {HTMLElement} target the canvas (pointer coordinates are relative to it)
   * @param {Window} win
   */
  constructor(ring, target, win) {
    this.ring = ring;
    this.target = target;
    this.win = win;
    this.lastPad = { a: 0, b: 0, c: 0, connected: false };
    /** @type {[string, EventTarget, (e: any) => void, AddEventListenerOptions | undefined][]} */
    this.listeners = [
      ['keydown', win, (e) => this.#key(e, 1), undefined],
      ['keyup', win, (e) => this.#key(e, 0), undefined],
      ['pointermove', target, (e) => this.#pointer(e), { passive: true }],
      ['pointerdown', target, (e) => this.#button(e, 1), undefined],
      ['pointerup', target, (e) => this.#button(e, 0), undefined],
      ['wheel', target, (e) => this.ring.push(InputKind.WHEEL, Math.round(e.deltaY)), { passive: true }],
      ['contextmenu', target, (e) => e.preventDefault(), undefined],
      ['blur', win, () => this.ring.push(InputKind.BLUR, 0), undefined],
      ['visibilitychange', win.document, () => win.document.hidden && this.ring.push(InputKind.BLUR, 0), undefined],
    ];
  }

  attach() {
    for (const [type, t, fn, opts] of this.listeners) t.addEventListener(type, fn, opts);
  }

  detach() {
    for (const [type, t, fn, opts] of this.listeners) t.removeEventListener(type, fn, opts);
  }

  /** @param {KeyboardEvent} e @param {number} down */
  #key(e, down) {
    const el = /** @type {HTMLElement | null} */ (e.target);
    if (el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
    const code = InputCodes.key(e.code);
    if (SUPPRESS.has(e.code)) e.preventDefault();
    if (!code || e.repeat) return;
    this.ring.push(InputKind.KEY, code, down);
  }

  /** @param {PointerEvent} e */
  #pointer(e) {
    const r = this.target.getBoundingClientRect();
    const dpr = this.win.devicePixelRatio || 1;
    this.ring.push(InputKind.POINTER, Math.round((e.clientX - r.left) * dpr), Math.round((e.clientY - r.top) * dpr), e.buttons);
  }

  /** @param {PointerEvent} e @param {number} down */
  #button(e, down) {
    this.#pointer(e);
    this.ring.push(InputKind.BUTTON, e.button, down);
  }

  /** Polls the first gamepad; pushes a record when its state changed. Call once per animation frame. */
  pollGamepads() {
    const pads = this.win.navigator.getGamepads ? this.win.navigator.getGamepads() : [];
    const pad = pads.find((p) => p && p.connected);
    if (!pad) {
      if (this.lastPad.connected) {
        this.lastPad = { a: 0, b: 0, c: 0, connected: false };
        this.ring.push(InputKind.GAMEPAD, 0, 0, 0);
      }
      return;
    }
    const q = (/** @type {number | undefined} */ v) => Math.max(-32767, Math.min(32767, Math.round((v ?? 0) * 32767)));
    const a = (q(pad.axes[0]) & 0xffff) | (q(pad.axes[1]) << 16);
    const b = (q(pad.axes[2]) & 0xffff) | (q(pad.axes[3]) << 16);
    let c = 0;
    for (let i = 0; i < pad.buttons.length && i < 31; i++) if (pad.buttons[i].pressed || pad.buttons[i].value > 0.5) c |= 1 << i;
    const last = this.lastPad;
    if (a === last.a && b === last.b && c === last.c && last.connected) return;
    this.lastPad = { a, b, c, connected: true };
    this.ring.push(InputKind.GAMEPAD, a, b, c);
  }
}
