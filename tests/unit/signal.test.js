import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Computed, Signal, Signals } from '../../engine/ui/signal.js';

test('effects run once per flush, only after a real change', () => {
  const a = new Signal(1);
  const seen = [];
  const dispose = Signals.effect(() => seen.push(a.value));
  assert.deepEqual(seen, [1], 'runs once immediately');
  a.value = 2;
  a.value = 3;
  assert.deepEqual(seen, [1], 'batched until the flush');
  assert.equal(Signals.flush(), 1);
  assert.deepEqual(seen, [1, 3]);
  a.value = 3;
  assert.equal(Signals.flush(), 0, 'setting an equal value changes nothing');
  dispose();
  a.value = 4;
  Signals.flush();
  assert.deepEqual(seen, [1, 3]);
});

test('computed values are lazy, cached, and computed once in a diamond', () => {
  const base = new Signal(2);
  let runs = 0;
  const double = new Computed(() => {
    runs++;
    return base.value * 2;
  });
  const left = new Computed(() => double.value + 1);
  const right = new Computed(() => double.value - 1);
  const seen = [];
  Signals.effect(() => seen.push(left.value * right.value));
  assert.deepEqual(seen, [15]);
  assert.equal(runs, 1);
  base.value = 3;
  Signals.flush();
  assert.deepEqual(seen, [15, 35]);
  assert.equal(runs, 2, 'double ran once for both branches');
  assert.equal(double.value, 6);
  assert.equal(runs, 2, 'reading again uses the cache');
});

test('effects track dependencies dynamically, and near() ignores tiny changes', () => {
  const useA = new Signal(true);
  const a = new Signal('a');
  const b = new Signal('b');
  const seen = [];
  Signals.effect(() => seen.push(useA.value ? a.value : b.value));
  b.value = 'b2';
  assert.equal(Signals.flush(), 0, 'b is not a dependency yet');
  useA.value = false;
  Signals.flush();
  a.value = 'a2';
  assert.equal(Signals.flush(), 0, 'a is no longer a dependency');
  assert.deepEqual(seen, ['a', 'b2']);
  const n = new Signal(1, Signal.near(0.01));
  const nums = [];
  Signals.effect(() => nums.push(n.value));
  n.value = 1.001;
  n.value = 1.5;
  Signals.flush();
  assert.deepEqual(nums, [1, 1.5]);
});
