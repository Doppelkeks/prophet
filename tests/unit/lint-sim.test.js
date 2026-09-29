import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { lintSource, lintTree, stripCode } from '../../tools/lint-sim.js';

/** @param {string} path @param {string} src */
const rules = (path, src) => lintSource(path, src).map((p) => p.rule);

test('flags float APIs, clocks, float literals and bare division in sim JS', () => {
  const path = 'game/systems/sim/example.js';
  assert.deepEqual(rules(path, 'const a = Math.sin(x);'), ['math-float']);
  assert.deepEqual(rules(path, 'const t = performance.now();'), ['clock']);
  assert.deepEqual(rules(path, 'const f = 0.5 * x;'), ['float-literal']);
  assert.deepEqual(rules(path, 'const q = a / b;'), ['division']);
  assert.deepEqual(rules(path, 'const b = new Float32Array(4);'), ['float-array']);
  assert.deepEqual(rules(path, 'const m = Math.imul(a, b) | 0;'), []);
});

test('ignores comments and strings, and honours sim-allow', () => {
  const path = 'engine/swarm/reference/example.js';
  assert.deepEqual(rules(path, '// a / b and Math.sin(0.5)\nconst s = "1.5 / 2";'), []);
  assert.deepEqual(rules(path, 'const q = (a / b) | 0; // sim-allow: implements idiv'), []);
  // Comments become spaces of the same length, so column numbers stay valid.
  assert.equal(stripCode('a /* x / y */ b', false), `a${' '.repeat(13)}b`);
});

test('non-sim files are not checked for float rules', () => {
  assert.deepEqual(rules('engine/render/renderer.js', 'const a = Math.sin(0.5) / 2;'), []);
});

test('flags float types, literals and builtins in WGSL sim kernels only', () => {
  const kernel = 'engine/swarm/kernels/steer.wgsl';
  assert.deepEqual(rules(kernel, 'let v: f32 = 1.0;'), ['wgsl-float-type', 'wgsl-float-literal']);
  assert.deepEqual(rules(kernel, 'let d = sqrt(x);'), ['wgsl-float-builtin']);
  assert.deepEqual(rules(kernel, 'let d = x >> 2u; let m = 0xFFu;'), []);
  assert.deepEqual(rules('engine/render/shaders/cube.wgsl', 'let v: f32 = 1.0;'), []);
});

test('Atomics.wait is only allowed in the job-worker loop', () => {
  assert.deepEqual(rules('engine/app/engine-host.js', 'Atomics.wait(a, 0, 0);'), ['atomics-wait']);
  assert.deepEqual(rules('engine/jobs/job-worker-loop.js', 'Atomics.wait(a, 0, 0);'), []);
  assert.deepEqual(rules('engine/app/engine-host.js', 'Atomics.waitAsync(a, 0, 0);'), []);
});

test('the repository itself is clean', () => {
  const { problems } = lintTree(resolve(import.meta.dirname, '../..'));
  assert.deepEqual(problems, []);
});
