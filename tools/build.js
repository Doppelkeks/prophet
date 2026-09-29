// Production build (ADR-025, docs/engine/10-tooling-testing.md#build): esbuild in three passes, in
// dependency order: job worker → engine worker → main. A pass can only name the hashed files of the
// workers it launches once they exist, so each pass gets its own `PX_BUILD` (worker URLs, inlined text
// assets, build hash). The page, the CSS bundle, `_headers` and `build.json` complete `dist/web/`.
//   npm run build [-- --out dist/web]
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const outArg = process.argv.indexOf('--out');
const out = resolve(root, outArg > 0 ? process.argv[outArg + 1] : 'dist/web');
/** Text assets the engine loads by path (WgslPreprocessor.fetchLoader), inlined into PX_BUILD.shaders. */
const TEXT_ASSETS = ['/game/ui/palette.css'];
/** What the build hash covers: everything that can change what the bundles do. */
const SOURCES = ['engine', 'game', 'index.html', 'package-lock.json'];

/** @param {string} dir @returns {AsyncGenerator<string>} */
async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

/** @param {string} abs */
const urlPath = (abs) => '/' + relative(root, abs).split(sep).join('/');
/** @param {string | Uint8Array} data */
const sha = (data) => createHash('sha256').update(data).digest('hex');

async function buildHash() {
  const h = createHash('sha256');
  for (const s of SOURCES) {
    const abs = join(root, s);
    /** @type {string[]} */
    const files = [];
    if (s.includes('.')) files.push(abs);
    else for await (const f of walk(abs)) files.push(f);
    for (const f of files.sort()) h.update(urlPath(f)).update('\0').update(await readFile(f)).update('\0');
  }
  return h.digest('hex').slice(0, 16);
}

/** Every WGSL file of the engine and the game, plus the text assets, keyed by URL path. */
async function texts() {
  /** @type {Record<string, string>} */
  const map = {};
  for (const dir of ['engine', 'game']) {
    for await (const f of walk(join(root, dir))) if (f.endsWith('.wgsl')) map[urlPath(f)] = await readFile(f, 'utf8');
  }
  for (const p of TEXT_ASSETS) map[p] = await readFile(join(root, p), 'utf8');
  return map;
}

/**
 * One esbuild pass: bundles `entry` into `<name>-<hash>.<ext>` in `out`.
 * @param {string} entry @param {string} name @param {object | null} pxBuild
 */
async function pass(entry, name, pxBuild) {
  const result = await build({
    entryPoints: [join(root, entry)],
    bundle: true,
    format: 'esm',
    target: 'es2023',
    minify: true,
    write: false,
    legalComments: 'none',
    logLevel: 'warning',
    define: { DEV: 'false' },
    // One shared object per bundle (a `define` would copy the shader map into every use site).
    banner: pxBuild ? { js: `var PX_BUILD=${JSON.stringify(pxBuild)};` } : undefined,
  });
  const code = result.outputFiles[0].contents;
  const ext = entry.endsWith('.css') ? 'css' : 'js';
  const file = `${name}-${sha(code).slice(0, 10)}.${ext}`;
  await writeFile(join(out, file), code);
  return { file, bytes: code.length };
}

function git() {
  try {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain', '--', ...SOURCES], { cwd: root, encoding: 'utf8' }).trim() !== '';
    return { commit, dirty };
  } catch {
    return { commit: null, dirty: null };
  }
}

const t0 = performance.now();
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const hash = await buildHash();
const shaders = await texts();
const job = await pass('game/app/job-worker.js', 'job-worker', { workers: {}, shaders: {}, buildHash: hash });
const engine = await pass('game/app/engine-worker.js', 'engine-worker', { workers: { job: job.file }, shaders, buildHash: hash });
const main = await pass('game/app/main.js', 'main', { workers: { engine: engine.file }, shaders: {}, buildHash: hash });
const css = await pass('game/ui/app.css', 'app', null);
await writeFile(join(out, 'favicon.svg'), await readFile(join(root, 'game/ui/favicon.svg')));

let html = await readFile(join(root, 'index.html'), 'utf8');
for (const [from, to] of [
  ['href="/game/ui/favicon.svg"', 'href="./favicon.svg"'],
  ['href="/game/ui/app.css"', `href="./${css.file}"`],
  ['src="/game/app/main.js"', `src="./${main.file}"`],
]) {
  if (!html.includes(from)) throw new Error(`build: index.html no longer contains ${from}`);
  html = html.replace(from, to);
}
await writeFile(join(out, 'index.html'), html);
// Static hosts that read `_headers` (Netlify, Cloudflare Pages) make the page cross-origin isolated.
await writeFile(
  join(out, '_headers'),
  ['/*', '  Cross-Origin-Opener-Policy: same-origin', '  Cross-Origin-Embedder-Policy: require-corp', '  Cross-Origin-Resource-Policy: same-origin', ''].join('\n'),
);
const files = { main: main.file, engineWorker: engine.file, jobWorker: job.file, css: css.file };
const info = {
  buildHash: hash,
  git: git(),
  builtAt: new Date().toISOString(),
  node: process.version,
  files,
  bytes: { main: main.bytes, engineWorker: engine.bytes, jobWorker: job.bytes, css: css.bytes },
  shaders: Object.keys(shaders).length,
};
await writeFile(join(out, 'build.json'), JSON.stringify(info, null, 2) + '\n');
const kb = (/** @type {number} */ n) => `${(n / 1024).toFixed(1)} KiB`;
console.log(`build ${hash} → ${relative(root, out)} in ${Math.round(performance.now() - t0)} ms`);
for (const [k, f] of Object.entries(files)) console.log(`  ${k.padEnd(13)} ${f.padEnd(32)} ${kb(info.bytes[/** @type {keyof typeof info.bytes} */ (k)])}`);
console.log(`  ${Object.keys(shaders).length} text assets inlined into the engine worker`);
