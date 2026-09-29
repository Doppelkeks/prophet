// Timestamp pairs and the sample ring behind the perf numbers (docs/engine/03-rendering.md#profiling).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GpuTimer, Samples } from '../../engine/gpu/gpu-timer.js';

test('a pair lasts end − begin ns, read as 32-bit words; an unusable pair (end ≤ begin) counts as 0', () => {
  const pairs = new BigInt64Array([1000n, 251000n, 5000n, 5000n, 9000n, 8000n, 0xfffffff0n, 0x100000010n, 7n << 40n, (7n << 40n) + 123456789n]);
  const words = new Int32Array(pairs.buffer);
  assert.equal(GpuTimer.ns(words, 0, 0), 250000);
  assert.equal(GpuTimer.ns(words, 0, 1), 0);
  assert.equal(GpuTimer.ns(words, 0, 2), 0);
  assert.equal(GpuTimer.ns(words, 0, 3), 0x20, 'a carry across the low word');
  assert.equal(GpuTimer.ns(words, 0, 4), 123456789, 'large timestamps');
  assert.equal(GpuTimer.ns(words, 4, 0), 0, 'pairs start at word `at`');
});

test('samples: percentiles over the most recent values only', () => {
  const s = new Samples(4);
  assert.equal(s.percentile(0.95), 0, 'no samples');
  for (const v of [9, 1, 5, 3]) s.push(v);
  assert.equal(s.percentile(0.5), 5);
  assert.equal(s.percentile(0.95), 9);
  s.push(2); // overwrites the 9
  assert.equal(s.percentile(0.95), 5);
  assert.equal(s.count, 5);
  s.reset();
  assert.equal(s.percentile(0.5), 0);
});
