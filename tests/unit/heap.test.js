import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Heap } from '../../engine/core/heap.js';
import { BumpArena, PoolArena } from '../../engine/core/arenas.js';

test('every profile lays out contiguous, 64-byte aligned arenas after the header', () => {
  for (const profile of /** @type {const} */ (['high', 'std', 'test'])) {
    const { total, arenas } = Heap.layout(profile);
    assert.deepEqual(
      arenas.map((a) => a.name),
      Heap.ARENA_NAMES,
    );
    let off = Heap.HEADER_BYTES;
    for (const a of arenas) {
      assert.equal(a.off, off, `${profile}.${a.name} starts where the previous arena ends`);
      assert.equal(a.off % 64, 0);
      assert.ok(a.size > 0, `${profile}.${a.name} is not empty`);
      off += a.size;
    }
    assert.equal(off, total, `${profile}: the reserve takes the rest`);
    assert.equal(total % Heap.PAGE, 0);
  }
  // high and std share one heap size (docs/BUDGETS.md#shared-heap).
  assert.equal(Heap.layout('high').total, Heap.layout('std').total);
});

test('create formats the header; attach reads the same arena table', () => {
  for (const shared of [true, false]) {
    const heap = Heap.create('test', shared);
    assert.equal(heap.shared, shared);
    assert.equal(heap.bytes, Heap.PROFILES.test.total);
    assert.equal(heap.memory?.buffer.byteLength, heap.bytes, 'initial = maximum: the memory never grows');
    const again = Heap.attach(heap.buffer);
    assert.deepEqual([...again.arenas.values()], [...heap.arenas.values()]);
    assert.deepEqual(heap.arena('jobs'), Heap.layout('test').arenas.find((a) => a.name === 'jobs'));
    assert.throws(() => heap.arena('nope'), /unknown arena/);
  }
});

test('attach refuses a buffer that is not a formatted heap of this version', () => {
  assert.throws(() => Heap.attach(new ArrayBuffer(Heap.HEADER_BYTES)), /bad magic/);
  const heap = Heap.create('test', false);
  heap.i32[Heap.W.VERSION] = Heap.VERSION + 1;
  assert.throws(() => Heap.attach(heap.buffer), /version mismatch/);
});

test('BumpArena aligns, reports exhaustion with -1, and resets', () => {
  const bump = new BumpArena({ off: 1024, size: 256 });
  assert.equal(bump.alloc(10), 1024);
  assert.equal(bump.alloc(4, 64), 1088);
  assert.equal(bump.alloc(4), 1104);
  assert.equal(bump.alloc(200), -1, 'does not fit');
  assert.equal(bump.used, 84);
  bump.reset();
  assert.equal(bump.used, 0);
  assert.equal(bump.alloc(256), 1024, 'the whole region after a reset');
  assert.equal(bump.alloc(1), -1);
  assert.equal(bump.highWater, 256);
});

test('PoolArena hands out cache-line aligned blocks, lowest address first, LIFO on release', () => {
  assert.throws(() => new PoolArena({ off: 0, size: 1024 }, 100), /multiple of 64/);
  const pool = new PoolArena({ off: 100, size: 64 * 3 + 50 }, 64);
  assert.equal(pool.base, 128, 'rounded up to a cache line');
  assert.equal(pool.capacity, 3);
  const a = pool.alloc();
  const b = pool.alloc();
  const c = pool.alloc();
  assert.deepEqual([a, b, c], [128, 192, 256]);
  assert.equal(pool.alloc(), -1, 'exhausted');
  pool.release(b);
  pool.release(a);
  assert.equal(pool.alloc(), a, 'last released is reused first');
  assert.equal(pool.inUse, 2);
  assert.equal(pool.highWater, 3);
  assert.throws(() => pool.release(130), /bad offset/, 'DEV builds reject offsets that are not block starts');
});
