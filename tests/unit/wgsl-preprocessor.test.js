import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WgslPreprocessor } from '../../engine/gpu/wgsl-preprocessor.js';

/** @param {Record<string, string>} files */
const loader = (files) => async (/** @type {string} */ path) => {
  if (!(path in files)) throw new Error(`missing ${path}`);
  return files[path];
};

test('includes files once, relative to the including file', async () => {
  const pre = new WgslPreprocessor(loader({
    '/a/main.wgsl': '#include "lib.wgsl"\n#include "../b/util.wgsl"\nfn main() {}',
    '/a/lib.wgsl': '#include "../b/util.wgsl"\nfn lib() {}',
    '/b/util.wgsl': 'fn util() {}',
  }));
  const out = await pre.process('/a/main.wgsl');
  assert.equal(out.match(/fn util\(\)/g)?.length, 1);
  assert.ok(out.indexOf('fn util()') < out.indexOf('fn lib()'));
  assert.ok(out.indexOf('fn lib()') < out.indexOf('fn main()'));
});

test('ifdef, ifndef, else and define', async () => {
  const pre = new WgslPreprocessor(loader({
    '/m.wgsl': '#ifdef FAST\nfast\n#else\nslow\n#endif\n#define LATE\n#ifndef LATE\nnever\n#endif\n#ifdef LATE\nlate\n#endif',
  }));
  const plain = await pre.process('/m.wgsl');
  assert.match(plain, /slow/);
  assert.doesNotMatch(plain, /fast|never/);
  assert.match(plain, /late/);
  assert.match(await pre.process('/m.wgsl', ['FAST']), /fast/);
});

test('reports malformed directives', async () => {
  const pre = new WgslPreprocessor(loader({ '/x.wgsl': '#ifdef A\n', '/y.wgsl': '#bogus\n', '/z.wgsl': '#endif\n' }));
  await assert.rejects(pre.process('/x.wgsl'), /unterminated/);
  await assert.rejects(pre.process('/y.wgsl'), /unknown directive/);
  await assert.rejects(pre.process('/z.wgsl'), /#endif without/);
});
