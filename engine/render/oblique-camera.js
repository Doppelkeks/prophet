// @ts-check
// The 3/4 oblique camera (ADR-018, docs/engine/04-pixel-art-pipeline.md#projection): x right, y away from
// the camera along the ground, z up. In internal pixels (v up): u = x·ppm, v = (y + z)·ppm, depth ∝ y − z.
// The scene renders with the camera snapped to whole internal pixels; the remainder becomes an
// output-pixel offset in the upscale (docs/engine/04-pixel-art-pipeline.md#camera-snapping).

export class ObliqueCamera {
  /** @param {number} [ppm] pixels per meter (docs/BUDGETS.md#pixel--camera-constants) */
  constructor(ppm = 8) {
    this.ppm = ppm;
    /** Camera center on the screen plane, internal px. */
    this.U = 0;
    this.V = 0;
    /** Snapped camera. */
    this.snapU = 0;
    this.snapV = 0;
    /** World-space center (m), for depth. */
    this.y = 0;
  }

  /** Centers the camera on a world point (meters). @param {number} x @param {number} y @param {number} [z] */
  follow(x, y, z = 0) {
    this.U = x * this.ppm;
    this.V = (y + z) * this.ppm;
    this.snapU = Math.floor(this.U);
    this.snapV = Math.floor(this.V);
    this.y = y;
    return this;
  }

  /**
   * Internal-pixel position of a world point relative to the snapped camera (v up).
   * @param {number} x @param {number} y @param {number} z @param {number[] | Float32Array} out
   */
  project(x, y, z, out) {
    out[0] = x * this.ppm - this.snapU;
    out[1] = (y + z) * this.ppm - this.snapV;
    return out;
  }

  /**
   * Upscale sampling offset in internal pixels: the sub-pixel remainder rounded to whole output pixels.
   * Texture rows grow downward, so v flips.
   * @param {number} k integer scale
   * @param {number[] | Float32Array} [out] where to write (the renderer reuses one per frame)
   */
  offset(k, out = [0, 0]) {
    out[0] = Math.round((this.U - this.snapU) * k) / k;
    out[1] = -Math.round((this.V - this.snapV) * k) / k;
    return out;
  }
}
