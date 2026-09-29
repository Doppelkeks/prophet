// Enforces the rules for simulation code (docs/engine/09-determinism-coop.md#rules-for-sim-code).
// Zero dependencies: strips comments and string literals, then applies line-based bans.
// A line may opt out of one check with a trailing `// sim-allow: <reason>` comment.
//
// Usage: node tools/lint-sim.js [--root <dir>]   (exit code 1 on violations)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Directories (relative, '/'-separated) whose JS is simulation code. Any `sim/` directory under engine/ is too. */
export const SIM_JS_SCOPES = ['engine/swarm/reference/', 'game/systems/sim/'];
/** Individual sim JS files outside those directories. */
export const SIM_JS_FILES = ['engine/core/fixed.js', 'engine/core/rng.js', 'engine/core/hash32.js', 'engine/app/sim-core.js'];
/** Directories whose WGSL is simulation code. */
export const SIM_WGSL_SCOPES = ['engine/swarm/kernels/', 'game/shaders/sim/'];
/** The only file allowed to call Atomics.wait (job workers may block; nothing else may). */
export const ATOMICS_WAIT_ALLOWED = 'engine/jobs/job-worker-loop.js';

const JS_RULES = [
  {
    id: 'math-float',
    re: /\bMath\.(random|sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|exp|expm1|log|log2|log10|log1p|pow|sqrt|cbrt|hypot|fround|round|floor|ceil|trunc|abs|sign)\b/,
    msg: 'float Math API in sim code (use Fixed helpers)',
  },
  { id: 'clock', re: /\b(Date\.now|performance\.now|crypto\.getRandomValues)\b/, msg: 'wall clock or crypto randomness in sim code' },
  { id: 'intl', re: /\b(Intl|localeCompare|WeakRef|FinalizationRegistry)\b/, msg: 'non-deterministic API in sim code' },
  { id: 'float-array', re: /\bFloat(16|32|64)Array\b/, msg: 'float typed array in sim code' },
  { id: 'float-literal', re: /(?<![\w.$])(\d+\.\d*|\.\d+|\d+[eE][+-]?\d+)(?![\w$])/, msg: 'float literal in sim code' },
  { id: 'division', re: /\//, msg: 'bare "/" in sim code (use Fixed.idiv / Fixed.udiv)' },
];

const WGSL_RULES = [
  { id: 'wgsl-float-type', re: /\b(f32|f16|vec[234]f|vec[234]h|mat\d(x\d)?[fh]?)\b|vec[234]<\s*f(32|16)\s*>/, msg: 'float type in a WGSL sim kernel' },
  { id: 'wgsl-float-literal', re: /(?<![\w.])(\d+\.\d*|\.\d+|\d+[eE][+-]?\d+|\d+(\.\d+)?[fh])(?![\w])/, msg: 'float literal in a WGSL sim kernel' },
  {
    id: 'wgsl-float-builtin',
    re: /\b(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|exp|exp2|log|log2|pow|sqrt|inverseSqrt|floor|ceil|round|fract|trunc|mix|smoothstep|step|normalize|length|distance|degrees|radians|fma|ldexp|frexp|modf)\s*\(/,
    msg: 'float builtin in a WGSL sim kernel',
  },
  { id: 'wgsl-sampler', re: /\b(sampler|textureSample\w*)\b/, msg: 'sampling in a WGSL sim kernel' },
];

/**
 * Replaces comments and string/template literals with spaces, keeping line structure.
 * Good enough for our own code; not a full JS tokenizer (regex literals are not special-cased).
 * @param {string} src
 * @param {boolean} wgsl
 */
export function stripCode(src, wgsl) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') { out += ' '; i++; }
    } else if (c === '/' && d === '*') {
      out += '  '; i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; }
      if (i < n) { out += '  '; i += 2; }
    } else if (!wgsl && (c === '"' || c === "'" || c === '`')) {
      const q = c;
      out += ' '; i++;
      while (i < n && src[i] !== q) {
        if (src[i] === '\\') { out += ' '; i++; }
        if (i < n) { out += src[i] === '\n' ? '\n' : ' '; i++; }
      }
      if (i < n) { out += ' '; i++; }
    } else {
      out += c; i++;
    }
  }
  return out;
}

/**
 * Lints one file's source.
 * @param {string} path repo-relative path with '/' separators
 * @param {string} src
 * @returns {{ path: string, line: number, rule: string, msg: string }[]}
 */
export function lintSource(path, src) {
  const problems = [];
  const isWgsl = path.endsWith('.wgsl');
  const inSimJs =
    !isWgsl &&
    (SIM_JS_FILES.includes(path) || SIM_JS_SCOPES.some((s) => path.startsWith(s)) || (path.startsWith('engine/') && path.includes('/sim/')));
  const inSimWgsl = isWgsl && SIM_WGSL_SCOPES.some((s) => path.startsWith(s));
  const rawLines = src.split('\n');
  const codeLines = stripCode(src, isWgsl).split('\n');
  for (let ln = 0; ln < codeLines.length; ln++) {
    const code = codeLines[ln];
    const allowed = /sim-allow:/.test(rawLines[ln] ?? '');
    if (!isWgsl && path !== ATOMICS_WAIT_ALLOWED && /\bAtomics\.wait\s*\(/.test(code)) {
      problems.push({ path, line: ln + 1, rule: 'atomics-wait', msg: `Atomics.wait is only allowed in ${ATOMICS_WAIT_ALLOWED}` });
    }
    if (allowed) continue;
    const rules = inSimJs ? JS_RULES : inSimWgsl ? WGSL_RULES : [];
    for (const rule of rules) {
      if (rule.re.test(code)) problems.push({ path, line: ln + 1, rule: rule.id, msg: rule.msg });
    }
  }
  return problems;
}

/** @param {string} dir @param {string[]} out */
function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'dist' || name === 'test-results') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.js') || name.endsWith('.wgsl')) out.push(p);
  }
  return out;
}

/** @param {string} root */
export function lintTree(root) {
  const files = [];
  for (const top of ['engine', 'game']) {
    try { walk(join(root, top), files); } catch { /* directory may not exist yet */ }
  }
  const problems = [];
  for (const file of files) {
    const rel = relative(root, file).split(sep).join('/');
    problems.push(...lintSource(rel, readFileSync(file, 'utf8')));
  }
  return { files: files.length, problems };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rootArg = process.argv.indexOf('--root');
  const root = resolve(rootArg > 0 ? process.argv[rootArg + 1] : '.');
  const { files, problems } = lintTree(root);
  for (const p of problems) console.log(`${p.path}:${p.line}  ${p.rule}  ${p.msg}`);
  console.log(`lint:sim checked ${files} files, ${problems.length} problem(s)`);
  process.exit(problems.length ? 1 : 0);
}
