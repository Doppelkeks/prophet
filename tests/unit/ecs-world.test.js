import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Heap } from '../../engine/core/heap.js';
import { Component, Field, FieldType } from '../../engine/ecs/component.js';
import { ChunkView } from '../../engine/ecs/chunk-view.js';
import { Entity } from '../../engine/ecs/ecs-reader.js';
import { Manifest } from '../../engine/ecs/registry.js';
import { World } from '../../engine/ecs/world.js';
import { FIGHTER, Glow, Hp, Pos, SAMPLE_MANIFEST, Tagged, Target, Vel } from '../support/ecs-sample.js';

/** @param {{ capacity?: number, chunkBytes?: number }} [o] */
function makeWorld(o = {}) {
  const manifest = new Manifest(SAMPLE_MANIFEST);
  const heap = Heap.create('test', false);
  const world = new World(heap, manifest, { capacity: o.capacity ?? 1024, chunkBytes: o.chunkBytes ?? 1024, participants: 2 });
  return { manifest, heap, world };
}

test('the manifest numbers components and systems by key and installs field handles', () => {
  const m = new Manifest(SAMPLE_MANIFEST);
  const keys = m.components.list.map((K) => K.key);
  assert.deepEqual(keys, [...keys].sort());
  assert.equal(Pos.id, m.components.id(Pos));
  assert.equal(Field.component(Hp.max), Hp.id);
  assert.equal(Field.index(Hp.max), 1);
  assert.equal(Field.type(Hp.max), FieldType.u16);
  assert.equal(Field.type(Hp.armor), FieldType.u8);
  assert.equal(Field.type(Target.e), FieldType.entity);
  const shuffled = new Manifest({
    components: [...SAMPLE_MANIFEST.components].reverse(),
    systems: [...SAMPLE_MANIFEST.systems].reverse(),
  });
  assert.equal(shuffled.hash, m.hash, 'declaration order does not matter');
  assert.notEqual(new Manifest({ ...SAMPLE_MANIFEST, systems: SAMPLE_MANIFEST.systems.slice(1) }).hash, m.hash, 'the hash covers systems');

  class Floaty extends Component {
    static key = 'bad.floaty';
    static schema = /** @type {const} */ ({ v: 'f32' });
  }
  assert.throws(() => new Manifest({ components: [Floaty], systems: [] }), /f32 is only allowed in render-only/);
  class Clash extends Component {
    static key = 'sample.pos';
  }
  assert.throws(() => new Manifest({ components: [Pos, Clash], systems: [] }), /duplicate component key/);
  class Reserved extends Component {
    static key = 'bad.reserved';
    static schema = /** @type {const} */ ({ key: 'i32' });
  }
  assert.throws(() => new Manifest({ components: [Reserved], systems: [] }), /reserved/);
  new Manifest(SAMPLE_MANIFEST); // reinstall the sample handles
});

test('ECS chunks describe their own layout', () => {
  const { world, heap } = makeWorld();
  const id = world.archetype(FIGHTER);
  const arch = world.archetypes[id];
  assert.equal(arch.capacity, 28, '1 KiB chunk: 144-byte header, 31-byte rows, 16-byte aligned columns');
  for (const off of arch.offsets) assert.equal(off % 16, 0);
  const e = world.spawn(id);
  world.set(e, Pos.x, -7);
  world.set(e, Hp.max, 65535);
  world.set(e, Hp.armor, 300);
  world.set(e, Target.e, e);
  const view = new ChunkView(heap).reset(arch.chunks[0], 0);
  assert.equal(view.archetype, id);
  assert.equal(view.count, 1);
  assert.equal(view.entity(0), e);
  assert.equal(heap.i32[view.col(Pos.x)], -7);
  assert.equal(heap.u16[view.col(Hp.max)], 65535);
  assert.equal(heap.u8[view.col(Hp.armor)], 300 & 0xff, 'u8 columns truncate');
  assert.equal(heap.u32[view.col(Target.e)], e);
  assert.equal(world.get(e, Hp.armor), 44);
  assert.equal(world.get(e, Target.e), e);
  assert.equal(view.has(Glow.t), false);
  assert.throws(() => view.col(Glow.t), /no column/);
});

test('handles: generations, FIFO index reuse, refusal at capacity, null is never alive', () => {
  const { world } = makeWorld({ capacity: 8 });
  const a = world.archetype([Pos]);
  const es = [];
  for (let i = 0; i < 7; i++) es.push(world.spawn(a));
  assert.deepEqual(es.map(Entity.index), [1, 2, 3, 4, 5, 6, 7], 'index 0 is reserved');
  assert.ok(es.every((e) => Entity.gen(e) === 1));
  assert.equal(world.spawn(a), 0, 'capacity reached');
  assert.equal(world.refused, 1);
  assert.equal(world.alive(0), false);
  assert.equal(world.alive(Entity.make(0, 1)), false);
  assert.equal(world.despawn(es[2]), true);
  assert.equal(world.despawn(es[2]), false, 'a stale despawn is a no-op');
  assert.equal(world.despawn(es[4]), true);
  const b = world.spawn(a);
  const c = world.spawn(a);
  assert.deepEqual([Entity.index(b), Entity.gen(b)], [3, 2]);
  assert.deepEqual([Entity.index(c), Entity.gen(c)], [5, 2]);
  assert.equal(world.alive(es[2]), false, 'the old handle stays dead after its index is reused');
  assert.equal(world.set(es[2], Pos.x, 1), false);
  assert.equal(world.get(es[2], Pos.x, -1), -1);
  assert.equal(world.size, 7);
});

test('never-spawned indices are not alive, and generations wrap from 65535 to 1', () => {
  const { world, heap } = makeWorld({ capacity: 4 });
  const a = world.archetype([Pos]);
  assert.equal(world.alive(Entity.make(2, 1)), false, 'a guessed handle for a free index');
  const e = world.spawn(a);
  const index = Entity.index(e);
  heap.i32[world.genW + index] = 0xffff;
  const old = Entity.make(index, 0xffff);
  assert.equal(world.alive(old), true);
  world.despawn(old);
  assert.equal(heap.i32[world.genW + index], 1);
  world.spawn(a);
  world.spawn(a);
  const again = world.spawn(a);
  assert.equal(Entity.index(again), index);
  assert.equal(Entity.gen(again), 1);
});

test('add and remove move rows between archetypes and keep the shared fields', () => {
  const { world } = makeWorld();
  const pv = world.archetype([Pos, Vel]);
  const es = [0, 1, 2].map((i) => {
    const e = world.spawn(pv);
    world.set(e, Pos.x, 100 + i);
    world.set(e, Vel.vx, 200 + i);
    return e;
  });
  assert.equal(world.add(es[0], Hp, [55, 99, 3]), true);
  assert.deepEqual(world.archetypes[world.archetypeOf(es[0])].components, [Hp.id, Pos.id, Vel.id].sort((x, y) => x - y));
  assert.deepEqual([world.get(es[0], Pos.x), world.get(es[0], Vel.vx), world.get(es[0], Hp.hp), world.get(es[0], Hp.max)], [100, 200, 55, 99]);
  // The last row of the source chunk filled the hole: its location was patched.
  assert.deepEqual([world.get(es[2], Pos.x), world.get(es[2], Vel.vx)], [102, 202]);
  assert.deepEqual([world.get(es[1], Pos.x), world.get(es[1], Vel.vx)], [101, 201]);
  assert.equal(world.remove(es[0], Vel), true);
  assert.equal(world.remove(es[0], Vel), false, 'removing an absent component is a no-op');
  assert.deepEqual([world.get(es[0], Pos.x), world.get(es[0], Hp.hp), world.get(es[0], Vel.vx, -1)], [100, 55, -1]);
  const arch = world.archetypeOf(es[0]);
  world.add(es[0], Hp, [7]);
  assert.equal(world.archetypeOf(es[0]), arch, 'adding a present component overwrites in place');
  assert.deepEqual([world.get(es[0], Hp.hp), world.get(es[0], Hp.max)], [7, 0]);
  world.add(es[1], Tagged);
  assert.equal(world.hasComponent(es[1], Tagged), true);
  assert.equal(world.get(es[1], Pos.x), 101);
});

test('empty chunks return to the pool; iteration follows archetype, chunk sequence, row', () => {
  const { world } = makeWorld();
  const a = world.archetype([Pos]);
  const cap = world.archetypes[a].capacity;
  const es = [];
  for (let i = 0; i < cap * 2 + 5; i++) es.push(world.spawn(a));
  const arch = world.archetypes[a];
  assert.equal(arch.chunks.length, 3);
  const [first, second, third] = arch.chunks;
  const inUse = world.pool.inUse;
  for (let i = 0; i < cap; i++) world.despawn(es[i]);
  assert.deepEqual(arch.chunks, [second, third], 'the emptied chunk left, the order of the rest is kept');
  assert.equal(world.pool.inUse, inUse - 1);
  assert.deepEqual(world.entities({ all: [Pos] }), es.slice(cap));
  const b = world.archetype([Pos, Vel]);
  const later = world.spawn(b);
  const early = world.spawn(a); // lands in the first chunk with room: `third`
  assert.equal(world.archetypes[a].chunks.length, 2);
  assert.deepEqual(world.entities({ all: [Pos] }), [...es.slice(cap), early, later], 'archetype ID first, then chunk sequence, then row');
  assert.ok(first >= 0);
});

test('change detection works per chunk and per column', () => {
  const { world } = makeWorld();
  const a = world.archetype([Pos, Hp]);
  world.bumpClock(); // 1
  const e = world.spawn(a);
  const q = world.query({ all: [Pos], changed: [Hp] });
  assert.equal(q.chunkList(0).length, 1, 'new rows count as changed');
  assert.equal(q.chunkList(1).length, 0);
  world.bumpClock(); // 2
  world.set(e, Pos.x, 5);
  assert.equal(q.chunkList(1).length, 0, 'a Pos write does not touch the Hp columns');
  world.set(e, Hp.armor, 5);
  assert.equal(q.chunkList(1).length, 1);
  assert.throws(() => world.query({ changed: [Tagged] }), /tag/);
});

test('the state hash covers handles and sim fields, not render-only fields', () => {
  const build = () => {
    const { world } = makeWorld();
    const a = world.archetype([Pos, Hp, Glow]);
    const es = [1, 2, 3].map((i) => {
      const e = world.spawn(a);
      world.set(e, Pos.x, i);
      world.set(e, Hp.hp, 10 * i);
      return e;
    });
    return { world, es };
  };
  const one = build();
  const two = build();
  assert.equal(one.world.hash(), two.world.hash());
  two.world.set(two.es[1], Glow.t, 0.25);
  assert.equal(one.world.hash(), two.world.hash(), 'render-only data is not sim state');
  two.world.set(two.es[1], Hp.hp, 21);
  assert.notEqual(one.world.hash(), two.world.hash());
});
