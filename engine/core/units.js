// @ts-check
// Load-time conversions from authored data (metres, seconds, degrees) to simulation integers.
// NOT simulation code: these run once when data is loaded, so floats are fine here. The results
// are integers, and tests pin them, so every machine starts the simulation from identical values.

export const TICK_HZ = 60;

export class Units {
  /** Metres to Q10 (1/1024 m). @param {number} metres */
  static q10(metres) {
    return Math.round(metres * 1024) | 0;
  }

  /** Metres per second to Q10 per tick. @param {number} mps */
  static q10PerTick(mps) {
    return Math.round((mps * 1024) / TICK_HZ) | 0;
  }

  /** Hit points to Q8. @param {number} hp */
  static q8(hp) {
    return Math.round(hp * 256) | 0;
  }

  /** Multiplier to Q12 (4096 = 1.0). @param {number} m */
  static q12(m) {
    return Math.round(m * 4096) | 0;
  }

  /** Probability (0..1) to Q16. @param {number} p */
  static q16(p) {
    return Math.max(0, Math.min(65536, Math.round(p * 65536))) | 0;
  }

  /** Seconds to ticks. @param {number} s */
  static ticks(s) {
    return Math.round(s * TICK_HZ) | 0;
  }

  /** Degrees to a 16-bit binary angle. @param {number} deg */
  static brad(deg) {
    return (Math.round((deg * 65536) / 360) & 0xffff) >>> 0;
  }
}
