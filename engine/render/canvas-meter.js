// @ts-check
// Main thread: the exact device-pixel size of the canvas element (docs/engine/04-pixel-art-pipeline.md#resolution-and-scaling).
// The backing store must match device pixels, or the browser resamples the canvas and pixels stop being exact.

export class CanvasMeter {
  /** @param {ResizeObserverEntry} e @returns {[number, number]} */
  static measure(e) {
    const dp = e.devicePixelContentBoxSize; // exact where supported
    if (dp && dp.length) return [dp[0].inlineSize, dp[0].blockSize];
    const cs = e.contentBoxSize[0];
    const dpr = globalThis.devicePixelRatio || 1;
    return [Math.round(cs.inlineSize * dpr), Math.round(cs.blockSize * dpr)];
  }

  /**
   * Calls `onSize` with the device-pixel size now and whenever it changes (layout, page zoom, DPR).
   * @param {Element} el @param {(width: number, height: number) => void} onSize
   * @returns {ResizeObserver}
   */
  static observe(el, onSize) {
    let w = -1;
    let h = -1;
    const ro = new ResizeObserver((entries) => {
      const e = entries[entries.length - 1];
      const [nw, nh] = CanvasMeter.measure(e);
      if (nw === w && nh === h) return;
      w = nw;
      h = nh;
      onSize(nw, nh);
    });
    try {
      ro.observe(el, { box: 'device-pixel-content-box' });
    } catch {
      ro.observe(el); // no device-pixel box: content box × DPR
    }
    return ro;
  }
}
