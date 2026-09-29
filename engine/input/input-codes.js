// @ts-check
// Keyboard codes as small integers, so key records fit the input ring and key state fits a bitset.
// Codes follow `KeyboardEvent.code` (the physical key, independent of the layout).

const NAMES = [
  '',
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight',
  'Space', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'AltLeft', 'Tab', 'Enter', 'Escape', 'Backquote',
  'KeyQ', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP',
  'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM',
  'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0',
  'Minus', 'Equal', 'BracketLeft', 'BracketRight', 'F1', 'F2', 'F3', 'F4',
];

/** @type {Map<string, number>} */
const BY_NAME = new Map(NAMES.map((n, i) => [n, i]));

export class InputCodes {
  /** Number of codes (key state bitsets need this many bits). */
  static COUNT = NAMES.length;

  /** Code of a `KeyboardEvent.code`, or 0 for keys the engine ignores. @param {string} name */
  static key(name) {
    return BY_NAME.get(name) ?? 0;
  }

  /** @param {number} code */
  static name(code) {
    return NAMES[code] ?? '';
  }
}
