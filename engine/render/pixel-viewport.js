// @ts-check
// Integer scale and internal render size (docs/engine/04-pixel-art-pipeline.md#resolution-and-scaling).
// Render-side code: floats are fine here.

export class PixelViewport {
  static BORDER = 2; // px per side (docs/BUDGETS.md#pixel--camera-constants)
  static ZOOM_HEIGHTS = Object.freeze({ near: 216, default: 270, far: 360 });

  constructor() {
    this.k = 1;
    this.viewW = 1;
    this.viewH = 1;
    this.internalW = 1 + 2 * PixelViewport.BORDER;
    this.internalH = 1 + 2 * PixelViewport.BORDER;
    this.cropX = 0;
    this.cropY = 0;
    this.devW = 1;
    this.devH = 1;
  }

  /**
   * @param {number} devW canvas width in device pixels
   * @param {number} devH canvas height in device pixels
   * @param {number} [zoomH] the zoom level's internal height
   */
  resize(devW, devH, zoomH = PixelViewport.ZOOM_HEIGHTS.default) {
    this.devW = devW;
    this.devH = devH;
    this.k = Math.max(1, Math.round(devH / zoomH));
    this.viewW = Math.ceil(devW / this.k);
    this.viewH = Math.ceil(devH / this.k);
    this.internalW = this.viewW + 2 * PixelViewport.BORDER;
    this.internalH = this.viewH + 2 * PixelViewport.BORDER;
    this.cropX = (this.viewW * this.k - devW) >> 1; // overscan below k px, split evenly
    this.cropY = (this.viewH * this.k - devH) >> 1;
    return this;
  }
}
