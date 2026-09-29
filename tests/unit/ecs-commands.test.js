// Command-buffer fuzzing (docs/engine/02-core-ecs-jobs.md#testing): random op sequences, recorded into
// several participants' buffers in random arrival order, applied by the real ECS and by a naive
// Map-based reference in (system ID, chunk index) order. States must match after every round.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Heap } from '../../engine/core/heap.js';
import { Field } from '../../engine/ecs/component.js';
import { CommandApplier, CommandWriter } from '../../engine/ecs/command-buffer.js';
import { Manifest } from '../../engine/ecs/registry.js';
import { World } from '../../engine/ecs/world.js';
import { FIGHTER, Glow, Hp, Pos, SAMPLE_MANIFEST, Tagged, Target, Vel } from '../support/ecs-sample.js';
import { ReferenceEcs } from '../support/reference-ecs.js';
import { TestRandom } from '../support/vectors.js';

const CAPACITY = 300;
const PARTICIPANTS = 3;

/**
 * @typedef {{ op: 'spawn', arch: number, p: number }
 *   | { op: 'despawn', e: number }
 *   | { op: 'add', e: number, comp: number, values: number[] }
 *   | { op: 'remove', e: number, comp: number }
 *   | { op: 'set', e: number, field: number, value: number }} Op
 */

function setup() {
  const manifest = new Manifest(SAMPLE_MANIFEST);
  const heap = Heap.create('test', false);
  const world = new World(heap, manifest, { capacity: CAPACITY, chunkBytes: 1024, participants: PARTICIPANTS });
  const lists = [[], [Pos], [Pos, Vel], FIGHTER, [...FIGHTER, Glow], [Tagged], [Hp, Tagged]];
  const archetypes = lists.map((list) => ({ id: world.archetype(list), comps: list.map((K) => K.id) }));
  const writers = Array.from({ length: PARTICIPANTS }, (_, p) => new CommandWriter(heap, world.cmdW + p * world.cmdStride, world.cmdStride));
  return { manifest, heap, world, archetypes, writers, applier: new CommandApplier(world) };
}

/**
 * @param {TestRandom} rnd
 * @param {ReferenceEcs} ref
 * @param {number[]} graveyard despawned handles
 * @param {{ id: number }[]} archetypes
 * @param {import('../../engine/ecs/registry.js').ComponentRegistry} registry
 * @returns {Op[]}
 */
function randomOps(rnd, ref, graveyard, archetypes, registry) {
  const alive = [...ref.alive.keys()];
  let provisional = 0;
  const handle = () => {
    const r = rnd.below(10);
    if (r < 5 && alive.length) return alive[rnd.below(alive.length)];
    if (r < 8 && provisional) return 1 + rnd.below(provisional);
    if (r < 9 && graveyard.length) return graveyard[rnd.below(graveyard.length)];
    return r === 9 ? 0 : ((1 << 16) | (1 + rnd.below(CAPACITY - 1))) >>> 0;
  };
  /** @type {Op[]} */
  const ops = [];
  const n = rnd.below(12);
  for (let k = 0; k < n; k++) {
    const r = rnd.below(100);
    const comp = rnd.below(registry.list.length);
    if (r < 25) ops.push({ op: 'spawn', arch: archetypes[rnd.below(archetypes.length)].id, p: ++provisional });
    else if (r < 40) ops.push({ op: 'despawn', e: handle() });
    else if (r < 55) {
      const nf = registry.fields[comp].length;
      ops.push({ op: 'add', e: handle(), comp, values: rnd.below(3) ? Array.from({ length: rnd.below(nf + 1) }, () => rnd.i32() >> rnd.below(24)) : [] });
    } else if (r < 70) ops.push({ op: 'remove', e: handle(), comp });
    else {
      const fields = registry.fields[comp];
      if (!fields.length) continue;
      const f = fields[rnd.below(fields.length)];
      const value = f.type === 2 ? handle() : rnd.i32() >> rnd.below(24);
      ops.push({ op: 'set', e: handle(), field: f.handle, value });
    }
  }
  return ops;
}

/** @param {CommandWriter} w @param {Op[]} ops */
function record(w, ops) {
  for (const o of ops) {
    if (o.op === 'spawn') assert.equal(w.spawn(o.arch), o.p);
    else if (o.op === 'despawn') w.despawn(o.e);
    else if (o.op === 'add') w.addId(o.e, o.comp, o.values);
    else if (o.op === 'remove') w.removeId(o.e, o.comp);
    else w.set(o.e, o.field, o.value);
  }
}

/**
 * @param {ReferenceEcs} ref @param {Op[]} ops @param {{ id: number, comps: number[] }[]} archetypes
 * @param {import('../../engine/ecs/registry.js').ComponentRegistry} registry @param {number[]} graveyard
 */
function applyReference(ref, ops, archetypes, registry, graveyard) {
  /** @type {Map<number, number>} */
  const prov = new Map();
  const real = (/** @type {number} */ h) => ((h >>>= 0), h !== 0 && h < 0x10000 ? (prov.get(h) ?? 0) : h);
  for (const o of ops) {
    if (o.op === 'spawn') prov.set(o.p, ref.spawn(/** @type {{ comps: number[] }} */ (archetypes.find((a) => a.id === o.arch)).comps));
    else if (o.op === 'despawn') {
      const e = real(o.e);
      if (ref.alive.has(e)) graveyard.push(e);
      ref.despawn(e);
    } else if (o.op === 'add') {
      const fields = registry.fields[o.comp];
      const values = o.values.map((v, i) => (i < fields.length && fields[i].type === 2 ? real(v) : v));
      ref.add(real(o.e), o.comp, values.length ? values : null);
    } else if (o.op === 'remove') ref.remove(real(o.e), o.comp);
    else ref.set(real(o.e), o.field, Field.type(o.field) === 2 ? real(o.value) : o.value);
  }
}

/** @param {World} world @param {ReferenceEcs} ref @param {string} where */
function compare(world, ref, where) {
  assert.equal(world.size, ref.alive.size, `${where}: live count`);
  assert.equal(world.refused, ref.refused, `${where}: refused spawns`);
  assert.deepEqual(new Set(world.entities()), new Set(ref.alive.keys()), `${where}: live handles`);
  for (const [e, rec] of ref.alive) {
    const comps = world.archetypes[world.archetypeOf(e)].components;
    assert.deepEqual(comps, [...rec.comps].sort((a, b) => a - b), `${where}: components of ${e.toString(16)}`);
    for (const [field, value] of rec.values) assert.equal(world.get(e, field), value, `${where}: field 0x${field.toString(16)} of ${e.toString(16)}`);
  }
}

test('command buffers match a naive reference ECS under random op sequences', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const a = setup();
    const b = setup(); // same segments, different participants and arrival order
    const registry = a.manifest.components;
    const ref = new ReferenceEcs(registry, CAPACITY);
    /** @type {number[]} */
    const graveyard = [];
    const rnd = new TestRandom(seed * 7919);
    const shuffle = new TestRandom(seed * 104729);
    for (let round = 0; round < 80; round++) {
      /** @type {Map<string, { key: [number, number], ops: Op[] }>} */
      const segments = new Map();
      const count = 1 + rnd.below(8);
      while (segments.size < count) {
        /** @type {[number, number]} */
        const key = [rnd.below(20), rnd.below(40)];
        if (!segments.has(`${key}`)) segments.set(`${key}`, { key, ops: randomOps(rnd, ref, graveyard, a.archetypes, registry) });
      }
      const list = [...segments.values()];
      for (const target of [a, b]) {
        const order = [...list];
        for (let i = order.length - 1; i > 0; i--) {
          const j = shuffle.below(i + 1);
          [order[i], order[j]] = [order[j], order[i]];
        }
        for (const s of order) {
          const w = target.writers[shuffle.below(PARTICIPANTS)];
          w.begin(s.key[0], s.key[1]);
          record(w, s.ops);
          w.end();
        }
        target.applier.apply();
      }
      for (const s of [...list].sort((x, y) => x.key[0] - y.key[0] || x.key[1] - y.key[1])) applyReference(ref, s.ops, a.archetypes, registry, graveyard);
      compare(a.world, ref, `seed ${seed} round ${round}`);
      assert.equal(a.world.hash(), b.world.hash(), `seed ${seed} round ${round}: arrival order changed the result`);
    }
    assert.ok(ref.alive.size > 0 && graveyard.length > 0, 'the fuzz exercised spawns and despawns');
  }
});

test('provisional handles are local to their segment and patched in entity fields', () => {
  const { world, writers, applier, archetypes } = setup();
  const fighter = archetypes[3].id;
  const w = writers[0];
  w.begin(1, 0);
  const a = w.spawn(fighter);
  const b = w.spawn(fighter);
  w.set(a, Target.e, b);
  w.set(b, Target.e, a);
  w.end();
  w.begin(2, 0);
  w.set(1, Pos.x, 42); // provisional 1 of THIS segment: it spawned nothing, so this is a no-op
  w.end();
  applier.apply();
  assert.deepEqual([a, b], [1, 2]);
  const [ea, eb] = world.entities();
  assert.ok(ea >= 0x10000 && eb >= 0x10000, 'real handles');
  assert.equal(world.get(ea, Target.e), eb);
  assert.equal(world.get(eb, Target.e), ea);
  assert.equal(world.get(ea, Pos.x), 0);
});

test('a later set wins, and nothing applies to an entity after its despawn', () => {
  const { world, writers, applier, archetypes } = setup();
  const e = world.spawn(archetypes[3].id);
  writers[1].begin(5, 1);
  writers[1].set(e, Hp.hp, 2);
  writers[1].despawn(e);
  writers[1].set(e, Hp.hp, 3);
  writers[1].end();
  writers[0].begin(5, 0);
  writers[0].set(e, Hp.hp, 1);
  writers[0].end();
  writers[2].begin(4, 9);
  writers[2].set(e, Hp.hp, 9);
  writers[2].end();
  const order = [];
  const set = world.set.bind(world);
  world.set = (/** @type {number} */ x, /** @type {number} */ f, /** @type {number} */ v) => (order.push(v), set(x, f, v));
  applier.apply();
  assert.deepEqual(order, [9, 1, 2, 3], 'applied in (system, chunk) order: (4,9), (5,0), (5,1)');
  assert.equal(world.alive(e), false);
  assert.equal(world.heap.i32[world.cmdW], 0, 'buffers are cleared');
});
