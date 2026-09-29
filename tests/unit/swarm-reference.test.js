// Scene tests for the reference swarm (docs/engine/05-gpu-swarm.md#testing): each pass's rules on small,
// hand-placed scenes, plus shuffle invariance and a golden hash.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProxyFlag, Team } from '../../engine/swarm/swarm-contract.js';
import { SwarmHarness, TEST_TYPES } from '../support/swarm-harness.js';

const M = 1024; // one meter in Q10

test('separation: overlapping units part until they stop overlapping, coincident ones split by slot', () => {
  const h = new SwarmHarness();
  h.unit(0, 0, 0);
  h.unit(1, 200, 0);
  h.unit(5, 10 * M, 10 * M);
  h.unit(6, 10 * M, 10 * M); // exactly on top of each other
  for (let t = 0; t < 90; t++) h.step();
  const R = 2 * TEST_TYPES[0].radius;
  const [ax] = h.pos(0);
  const [bx] = h.pos(1);
  assert.ok(bx - ax >= R - 64, `pair apart: ${bx - ax} vs ${R}`);
  const [cx, cy] = h.pos(5);
  const [dx, dy] = h.pos(6);
  assert.ok(cx < dx && dx - cx >= R - 64 && cy === dy, 'the lower slot moved to −x, the higher to +x');
  const [vx] = [h.ref.b.U[h.L.uVel + 0]];
  assert.equal(vx, 0, 'velocities settle exactly once nothing pushes');
});

test('separation in a dense cell uses the centroid and pressure terms, and spreads the crowd', () => {
  const h = new SwarmHarness();
  for (let s = 0; s < 40; s++) h.unit(s, 5 * M + (s % 7) * 40, 5 * M + ((s * 3) % 5) * 40);
  const cellOf = () => {
    const counts = new Map();
    for (let s = 0; s < 40; s++) {
      const [x, y] = h.pos(s);
      const k = `${(x - h.L.originX) >> h.L.cellShift},${(y - h.L.originY) >> h.L.cellShift}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return Math.max(...counts.values());
  };
  assert.equal(cellOf(), 40);
  for (let t = 0; t < 120; t++) h.step();
  assert.ok(cellOf() < 20, `the densest cell now holds ${cellOf()}`);
});

test('projectiles hit the nearest unit, pierce once, and never hit the same unit twice in a row', () => {
  const h = new SwarmHarness();
  h.unit(0, 2 * M, 0, 0, 100000);
  h.unit(1, 3 * M, 0, 0, 100000);
  h.unit(2, 4 * M, 0, 0, 100000);
  h.shot(0, { x: 0, y: 0, vx: 300, vy: 0, dmg: 512, life: 60, pierce: 1, source: 3 });
  for (let t = 0; t < 30; t++) h.step();
  assert.deepEqual([h.hp(0), h.hp(1), h.hp(2)], [100000 - 512, 100000 - 512, 100000], 'two hits, then the shot died');
  assert.equal(h.shotAlive(0), false);
});

test('kill credit goes to the largest hit, ties to the higher source index', () => {
  const h = new SwarmHarness();
  h.unit(0, 0, 0, 0, 100);
  h.unit(1, 20 * M, 0, 0, 100);
  // Same damage from sources 4 and 9 on unit 0; different damage from sources 7 (big) and 12 on unit 1.
  h.shot(0, { x: -300, y: 0, vx: 300, vy: 0, dmg: 256, life: 5, source: 4 });
  h.shot(1, { x: 300, y: 0, vx: -300, vy: 0, dmg: 256, life: 5, source: 9 });
  h.shot(2, { x: 20 * M - 300, y: 0, vx: 300, vy: 0, dmg: 5000, life: 5, source: 7 });
  h.shot(3, { x: 20 * M + 300, y: 0, vx: -300, vy: 0, dmg: 256, life: 5, source: 12 });
  const out = /** @type {import('../../engine/swarm/swarm-contract.js').SwarmOutbound} */ (h.step());
  assert.equal(out.kills, 2);
  assert.equal(out.killsOfSource(9), 1);
  assert.equal(out.killsOfSource(4), 0);
  assert.equal(out.killsOfSource(7), 1);
  assert.equal(out.killsOfSource(12), 0);
  assert.equal(out.killsOfType(0), 2);
});

test('spawns take free slots in ascending order, reject the excess in order, and reuse slots with a new generation', () => {
  const h = new SwarmHarness({ units: 8 });
  let out = h.step((i) => i.spawnRing({ type: 1, count: 12, cx: 0, cy: 0, r0: 5 * M, r1: 6 * M }));
  assert.equal(out?.spawnsRejected, 4);
  assert.equal(h.count(), 8);
  for (let s = 0; s < 8; s++) assert.equal(h.gen(s), 1);
  // Kill slots 3 and 5 directly, then ask for three more.
  h.ref.b.U[h.L.uInfo + 3] = 0;
  h.ref.b.U[h.L.uInfo + 5] = 0;
  out = h.step((i) => i.spawnRing({ type: 1, count: 3, cx: 0, cy: 0, r0: M, r1: M }));
  assert.equal(out?.spawnsRejected, 1);
  assert.equal(h.gen(3), 2);
  assert.equal(h.gen(5), 2);
  assert.equal(h.gen(4), 1);
  const [x, y] = h.pos(3);
  assert.ok(Math.abs(Math.hypot(x, y) - M) < 8, 'on the requested ring (1 m)');
});

test('contact damage lands only on the type’s attack cadence', () => {
  const h = new SwarmHarness();
  h.unit(0, 100, 0, 0, 100000, 3); // interval 10, phase 3: ticks 7, 17, 27
  let total = 0;
  const ticks = [];
  for (let t = 0; t < 30; t++) {
    const out = h.step((i) => i.proxy({ entity: 1, x: 0, y: 0, radius: 512, team: Team.PLAYER, flags: 0 }));
    if (out && out.proxyDamage(0)) {
      total += out.proxyDamage(0);
      ticks.push(t);
    }
  }
  assert.deepEqual(ticks, [7, 17, 27]);
  assert.equal(total, 3 * TEST_TYPES[0].contact);
});

test('targeting picks the nearest unit in range (ties to the lower slot) and the shot spawns next tick', () => {
  const h = new SwarmHarness();
  h.unit(4, 3 * M, 0, 0, 100000);
  h.unit(2, 0, 3 * M, 0, 100000); // same distance, lower slot
  h.unit(1, 20 * M, 0, 0, 100000); // out of range
  const fire = (/** @type {import('../../engine/swarm/swarm-contract.js').SwarmInbound} */ i) =>
    i.fire({ source: 0, x: 0, y: 0, range: 8 * M, damage: 300, speed: 400, life: 30 });
  const out = h.step((i) => {
    fire(i);
    i.fire({ source: 1, x: 40 * M, y: 40 * M, range: 2 * M, damage: 300, speed: 400, life: 30 });
  });
  assert.equal(out?.fireResult(0), true);
  assert.equal(out?.fireResult(1), false, 'nothing in range: not fired');
  assert.equal(out?.fired, 1);
  assert.equal(h.shotAlive(0), false, 'the shot appears in the next tick');
  h.step();
  assert.equal(h.shotAlive(0), true);
  for (let t = 0; t < 12; t++) h.step();
  assert.equal(h.hp(2), 100000 - 300, 'the lower slot was the target');
  assert.equal(h.hp(4), 100000);
});

test('the swarm chases proxy 0 and a pushing proxy keeps units off it', () => {
  const h = new SwarmHarness();
  for (let s = 0; s < 20; s++) h.unit(s, 12 * M + s * 300, -6 * M + s * 200);
  const patch = { entity: 1, x: 0, y: 0, radius: 512, team: Team.PLAYER, flags: ProxyFlag.PUSHES };
  for (let t = 0; t < 400; t++) h.step((i) => i.proxy(patch));
  let near = 0;
  for (let s = 0; s < 20; s++) {
    const d = Math.hypot(...h.pos(s));
    assert.ok(d > 512, `unit ${s} is kept off the proxy (${d})`);
    if (d < 4 * M) near++;
  }
  assert.ok(near >= 15, `${near} units reached the proxy`);
});

/** A busy scene: rings of all types, a pushing player proxy that fires every tick. */
function busy(/** @type {{ shuffle?: number }} */ o) {
  const h = new SwarmHarness({ units: 512, shots: 128 }, { seed: 777, shuffle: o.shuffle });
  const hashes = [];
  for (let t = 0; t < 240; t++) {
    const out = h.step((i) => {
      if (t % 40 === 0) i.spawnRing({ type: (t / 40) % 3, count: 60, cx: 0, cy: 0, r0: 8 * M, r1: 12 * M });
      i.proxy({ entity: 1, x: 0, y: 0, radius: 512, team: Team.PLAYER, flags: ProxyFlag.PUSHES });
      i.fire({ source: t % 5, x: 0, y: 0, range: 10 * M, damage: 700, speed: 600, life: 30, pierce: t % 2 });
    });
    hashes.push(h.ref.hash(), ...Array.from(/** @type {any} */ (out).block));
  }
  return { hashes, h };
}

test('shuffled bin and shot orders give the same results, tick for tick', () => {
  const base = busy({});
  assert.ok(base.h.count() > 0);
  for (const shuffle of [1, 99]) assert.deepEqual(busy({ shuffle }).hashes, base.hashes, `shuffle seed ${shuffle}`);
});

/**
 * Golden hash of the busy scene after 240 ticks. It pins the reference kernels: a change here is a
 * change to the simulation, re-blessed on purpose (docs/engine/09-determinism-coop.md#replays-and-hashes).
 */
const GOLDEN_BUSY = 0xc67b1fb0;

test('the busy scene matches its golden hash', () => {
  const { h } = busy({});
  assert.equal(h.ref.hash(), GOLDEN_BUSY, `got 0x${h.ref.hash().toString(16)}`);
});
