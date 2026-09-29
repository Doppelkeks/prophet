// @ts-check

/**
 * Resolves worker entry URLs (ADR-025).
 * Development: native ES modules, so the caller's `new URL('./x-worker.js', import.meta.url)` is used as is.
 * Production: esbuild defines PX_BUILD with the hashed file names of the worker bundles.
 */
export class WorkerUrls {
  /**
   * @param {string} role e.g. `engine` or `job`
   * @param {URL} devUrl the unbundled module URL
   * @returns {URL}
   */
  static resolve(role, devUrl) {
    if (typeof PX_BUILD !== 'undefined' && PX_BUILD && PX_BUILD.workers[role]) {
      return new URL(PX_BUILD.workers[role], import.meta.url);
    }
    return devUrl;
  }
}
