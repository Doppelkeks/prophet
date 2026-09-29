// @ts-check
// The per-tick input record (docs/engine/09-determinism-coop.md#input-as-commands): 8 bytes per player
// and tick, already quantized, so no float math reaches the sim.
//   word 0: move x (i8, bits 0-7) | move y (i8, bits 8-15) | aim (u16 binary angle, bits 16-31)
//   word 1: buttons (u16, bits 0-15) | flags (u8, bits 16-23) | UI command count (u8, bits 24-31)

/** Button bits. */
export const Buttons = Object.freeze({ DASH: 1, BUILD: 2, RECALL: 4, OVERCLOCK: 8, INTERACT: 16, FIRE: 32, PAUSE: 64 });
/** Flag bits. */
export const InputFlags = Object.freeze({ AIM_OVERRIDE: 1, GAMEPAD: 2 });
/** Largest move component; a full diagonal is (±90, ±90). */
export const MOVE_MAX = 127;

export class InputRecord {
  /**
   * @param {number} moveX -127..127 @param {number} moveY -127..127 (+y = up on screen)
   * @param {number} aim binary angle @param {number} buttons @param {number} flags @param {number} ui
   * @returns {[number, number]}
   */
  static pack(moveX, moveY, aim, buttons, flags, ui) {
    return [InputRecord.word0(moveX, moveY, aim), InputRecord.word1(buttons, flags, ui)];
  }

  /** Word 0 of a record: move and aim. @param {number} moveX @param {number} moveY @param {number} aim */
  static word0(moveX, moveY, aim) {
    return ((moveX & 0xff) | ((moveY & 0xff) << 8) | ((aim & 0xffff) << 16)) >>> 0;
  }

  /** Word 1 of a record: buttons, flags, UI command count. @param {number} buttons @param {number} flags @param {number} ui */
  static word1(buttons, flags, ui) {
    return ((buttons & 0xffff) | ((flags & 0xff) << 16) | ((ui & 0xff) << 24)) >>> 0;
  }

  /** @param {number} w0 */
  static moveX(w0) {
    return (w0 << 24) >> 24;
  }

  /** @param {number} w0 */
  static moveY(w0) {
    return (w0 << 16) >> 24;
  }

  /** @param {number} w0 */
  static aim(w0) {
    return w0 >>> 16;
  }

  /** @param {number} w1 */
  static buttons(w1) {
    return w1 & 0xffff;
  }

  /** @param {number} w1 */
  static flags(w1) {
    return (w1 >>> 16) & 0xff;
  }

  /** @param {number} w1 */
  static ui(w1) {
    return w1 >>> 24;
  }
}
