// Zero-dependency dev server (docs/engine/10-tooling-testing.md#dev-server).
// Serves a directory with COOP/COEP/CORP headers so `crossOriginIsolated` is true,
// and pushes file-change events over Server-Sent Events at /__events.
//
// Usage: node tools/dev-server.js [--port 4173] [--host 127.0.0.1] [--root .] [--no-coi] [--no-watch]
import { createServer } from 'node:http';
import { stat, readFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MIME = /** @type {Record<string, string>} */ ({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wgsl': 'text/wgsl; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.vox': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.map': 'application/json; charset=utf-8',
});

/** Headers that make a page cross-origin isolated (SharedArrayBuffer, shared WebAssembly.Memory). */
export const COI_HEADERS = Object.freeze({
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
});

export class DevServer {
  /**
   * @param {{ root: string, port?: number, host?: string, coi?: boolean, watch?: boolean, log?: boolean }} options
   */
  constructor(options) {
    this.root = resolve(options.root);
    this.port = options.port ?? 4173;
    this.host = options.host ?? '127.0.0.1';
    this.coi = options.coi ?? true;
    this.watchFiles = options.watch ?? true;
    this.log = options.log ?? true;
    /** @type {Set<import('node:http').ServerResponse>} */
    this.clients = new Set();
    /** @type {import('node:fs').FSWatcher | null} */
    this.watcher = null;
    this.server = createServer((req, res) => {
      this.#handle(req, res).catch((err) => {
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(String(err && err.stack ? err.stack : err));
      });
    });
  }

  /** @returns {Promise<number>} the bound port */
  start() {
    return new Promise((resolveStart, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, this.host, () => {
        const address = this.server.address();
        this.port = typeof address === 'object' && address ? address.port : this.port;
        if (this.watchFiles) this.#startWatch();
        if (this.log) {
          console.log(`[dev-server] http://localhost:${this.port}/  root=${this.root}  coi=${this.coi}`);
        }
        resolveStart(this.port);
      });
    });
  }

  /** @returns {Promise<void>} */
  stop() {
    this.watcher?.close();
    for (const client of this.clients) client.end();
    this.clients.clear();
    return new Promise((done) => this.server.close(() => done()));
  }

  /** @param {Record<string, string>} extra */
  #headers(extra) {
    return { ...(this.coi ? COI_HEADERS : {}), 'Cache-Control': 'no-store', ...extra };
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  async #handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/__events') return this.#sse(res);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, this.#headers({ Allow: 'GET, HEAD' }));
      return void res.end();
    }
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      res.writeHead(400, this.#headers({ 'Content-Type': 'text/plain' }));
      return void res.end('bad path');
    }
    const file = DevServer.resolveInside(this.root, pathname);
    if (!file) {
      res.writeHead(403, this.#headers({ 'Content-Type': 'text/plain' }));
      return void res.end('forbidden');
    }
    let target = file;
    const info = await stat(target).catch(() => null);
    if (info && info.isDirectory()) target = join(target, 'index.html');
    const body = await readFile(target).catch(() => null);
    if (!body) {
      res.writeHead(404, this.#headers({ 'Content-Type': 'text/plain' }));
      return void res.end('not found');
    }
    const type = MIME[extname(target).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, this.#headers({ 'Content-Type': type, 'Content-Length': String(body.length) }));
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  /**
   * Resolves a URL path inside `root`, or returns null on traversal.
   * @param {string} root absolute root directory
   * @param {string} pathname decoded URL path
   */
  static resolveInside(root, pathname) {
    if (pathname.includes('\0')) return null;
    const full = normalize(join(root, pathname));
    if (full !== root && !full.startsWith(root + sep)) return null;
    return full;
  }

  /** @param {import('node:http').ServerResponse} res */
  #sse(res) {
    res.writeHead(200, this.#headers({ 'Content-Type': 'text/event-stream', Connection: 'keep-alive' }));
    res.write(': connected\n\n');
    this.clients.add(res);
    res.on('close', () => this.clients.delete(res));
  }

  #startWatch() {
    try {
      this.watcher = watch(this.root, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const path = filename.split(sep).join('/');
        if (path.startsWith('node_modules/') || path.startsWith('.git/') || path.startsWith('test-results/')) return;
        const data = `event: change\ndata: ${JSON.stringify({ path })}\n\n`;
        for (const client of this.clients) client.write(data);
      });
    } catch (err) {
      if (this.log) console.warn('[dev-server] file watching unavailable:', err);
    }
  }

  /** @param {string[]} argv */
  static parseArgs(argv) {
    const opts = { root: '.', port: 4173, host: '127.0.0.1', coi: true, watch: true };
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      if (arg === '--port') opts.port = Number(argv[++i]);
      else if (arg === '--host') opts.host = argv[++i];
      else if (arg === '--root') opts.root = argv[++i];
      else if (arg === '--no-coi') opts.coi = false;
      else if (arg === '--no-watch') opts.watch = false;
      else throw new Error(`unknown argument: ${arg}`);
    }
    return opts;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = new DevServer(DevServer.parseArgs(process.argv.slice(2)));
  await server.start();
}
