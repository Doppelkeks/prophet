// Serves the game over a privileged `app://prophet/` scheme with the headers that make the page
// cross-origin isolated (docs/engine/08-platforms.md#desktop-electron). `file://` cannot be isolated.
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wgsl': 'text/wgsl; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.vox': 'application/octet-stream',
  '.bin': 'application/octet-stream',
};

export class AppProtocol {
  static SCHEME = 'app';
  static HOST = 'prophet';
  static ORIGIN = 'app://prophet';

  /** Must be registered before `app.ready`. */
  static PRIVILEGES = {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true },
  };

  static HEADERS = {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self' 'wasm-unsafe-eval'",
      "worker-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self'",
    ].join('; '),
  };

  /**
   * @param {Electron.Protocol} protocol
   * @param {string} root absolute directory served at app://prophet/
   */
  static install(protocol, root) {
    protocol.handle(AppProtocol.SCHEME, (request) => AppProtocol.serve(root, request.url));
  }

  /**
   * @param {string} root
   * @param {string} requestUrl
   * @returns {Promise<Response>}
   */
  static async serve(root, requestUrl) {
    const url = new URL(requestUrl);
    if (url.host !== AppProtocol.HOST) return AppProtocol.text(404, 'unknown host');
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return AppProtocol.text(400, 'bad path');
    }
    let file = AppProtocol.resolveInside(root, pathname);
    if (!file) return AppProtocol.text(403, 'forbidden');
    const info = await stat(file).catch(() => null);
    if (info && info.isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file).catch(() => null);
    if (!body) return AppProtocol.text(404, 'not found');
    const type = MIME[/** @type {keyof typeof MIME} */ (extname(file).toLowerCase())] ?? 'application/octet-stream';
    return new Response(body, { status: 200, headers: { 'Content-Type': type, ...AppProtocol.HEADERS } });
  }

  /** @param {string} root @param {string} pathname */
  static resolveInside(root, pathname) {
    if (pathname.includes('\0')) return null;
    const full = normalize(join(root, pathname));
    if (full !== root && !full.startsWith(root + sep)) return null;
    return full;
  }

  /** @param {number} status @param {string} text */
  static text(status, text) {
    return new Response(text, { status, headers: { 'Content-Type': 'text/plain', ...AppProtocol.HEADERS } });
  }
}
