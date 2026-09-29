// The readback ring on a fake device: in-order harvest, and a device loss that unmaps a slot after its
// map resolved (device.destroy() unmaps every buffer before device.lost resolves) marks the ring lost
// instead of throwing out of the frame.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReadbackRing } from '../../engine/gpu/readback-ring.js';

globalThis.GPUBufferUsage ??= /** @type {any} */ ({ MAP_READ: 1, COPY_DST: 8 });
globalThis.GPUMapMode ??= /** @type {any} */ ({ READ: 1 });

class FakeBuffer {
  /** @param {number} size */
  constructor(size) {
    this.data = new ArrayBuffer(size);
    this.mapped = false;
    /** @type {(() => void) | null} */
    this.resolveMap = null;
  }
  mapAsync() {
    return new Promise((resolve) => {
      this.resolveMap = () => {
        this.mapped = true;
        resolve(undefined);
      };
    });
  }
  getMappedRange() {
    if (!this.mapped) throw new Error('getMappedRange failed');
    return this.data;
  }
  unmap() {
    this.mapped = false;
  }
  destroy() {
    this.mapped = false;
  }
}

const device = /** @type {GPUDevice} */ (/** @type {unknown} */ ({ createBuffer: (/** @type {{ size: number }} */ d) => new FakeBuffer(d.size) }));
const flush = () => new Promise((r) => setTimeout(r, 0));

test('harvests in submission order, and a slot unmapped by a device loss marks the ring lost', async () => {
  const ring = new ReadbackRing(device, { slots: 3, bytes: 16 });
  const a = /** @type {import('../../engine/gpu/readback-ring.js').ReadbackSlot} */ (ring.acquire());
  ring.submitted(a, [1]);
  const b = /** @type {import('../../engine/gpu/readback-ring.js').ReadbackSlot} */ (ring.acquire());
  ring.submitted(b, [2]);
  /** @type {number[]} */
  const got = [];
  const take = (/** @type {import('../../engine/gpu/readback-ring.js').ReadbackSlot} */ s) => got.push(...s.ticks);
  /** @type {FakeBuffer} */ (/** @type {unknown} */ (b.buffer)).resolveMap?.(); // the later slot maps first
  await flush();
  assert.equal(ring.harvest(take), 0, 'slot 2 waits for slot 1');
  /** @type {FakeBuffer} */ (/** @type {unknown} */ (a.buffer)).resolveMap?.();
  await flush();
  assert.equal(ring.harvest(take), 2);
  assert.deepEqual(got, [1, 2]);

  const c = /** @type {import('../../engine/gpu/readback-ring.js').ReadbackSlot} */ (ring.acquire());
  ring.submitted(c, [3]);
  /** @type {FakeBuffer} */ (/** @type {unknown} */ (c.buffer)).resolveMap?.();
  await flush();
  c.buffer.unmap(); // device.destroy(): every buffer is unmapped, the slot still says 'ready'
  assert.equal(ring.harvest(take), 0, 'no throw out of the frame');
  assert.equal(ring.lost, true);
  assert.match(ring.lostReason, /getMappedRange failed/);
  assert.deepEqual(got, [1, 2]);
});
