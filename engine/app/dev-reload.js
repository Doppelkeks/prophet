// @ts-check

/**
 * Dev-only live reload over the dev server's Server-Sent Events (docs/engine/10-tooling-testing.md#dev-server).
 * CSS is swapped in place; everything else reloads the page for now (WGSL/data hot reload comes later).
 */
export class DevReload {
  /** @param {Location} location */
  static start(location) {
    if (!DEV || !location.protocol.startsWith('http') || typeof EventSource !== 'function') return null;
    const source = new EventSource('/__events');
    source.addEventListener('change', (event) => {
      const { path } = JSON.parse(/** @type {MessageEvent} */ (event).data);
      if (typeof path !== 'string' || path.startsWith('docs/') || path.startsWith('tests/')) return;
      if (path.endsWith('.css')) DevReload.reloadStyles();
      else location.reload();
    });
    return source;
  }

  static reloadStyles() {
    for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
      const href = /** @type {HTMLLinkElement} */ (link).href.replace(/[?&]v=\d+/, '');
      /** @type {HTMLLinkElement} */ (link).href = `${href}${href.includes('?') ? '&' : '?'}v=${Date.now()}`;
    }
  }
}
