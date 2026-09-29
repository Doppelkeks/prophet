// Scene tests for the reference swarm (docs/engine/05-gpu-swarm.md#testing): each pass's rules on small,
// hand-placed scenes, plus shuffle invariance and a golden hash.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EffectShape, EventClass, EventKind, ProxyFlag, Status, SwarmOutbound, Team } from '../../engine/swarm/swarm-contract.js';
import { EVENT_WORDS, OH, OUT_MAGIC, SwarmLayout } from '../../engine/swarm/swarm-layout.js';
import { SwarmHarness, TEST_TYPES } from '../support/swarm-harness.js';
import { FlowField } from '../../engine/nav/sim/flow-field.js';

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

/** @param {number} value @param {Partial<import('../../engine/swarm/swarm-contract.js').UnitType>} [o] */
const dropper = (value, o = {}) => [{ ...TEST_TYPES[0], dropChance: 65536, dropValue: value, ...o }];
/** @param {import('../../engine/swarm/swarm-contract.js').SwarmInbound} i @param {number} x @param {number} y @param {number} magnet */
const collector = (i, x, y, magnet) => i.proxy({ entity: 1, x, y, radius: 512, team: Team.PLAYER, flags: ProxyFlag.COLLECTOR, aux: magnet });

test('a death drops its scrap as a gem next tick, where the unit died; a collector pulls it in and counts it exactly', () => {
  const h = new SwarmHarness({}, { types: dropper(3) });
  h.unit(5, 10 * M, 0);
  h.doom(5);
  let out = h.step();
  assert.equal(h.alive(5), false);
  assert.equal(out?.scrapDropped, 3, 'dropped with its tick');
  assert.deepEqual(h.pickups(), [], 'the gem appears next tick');
  const [ux, uy] = h.pos(5);
  out = h.step();
  assert.deepEqual(h.pickups(), [[0, ux, uy, 3]], 'free pickup slot 0, at the death position');
  assert.equal(out?.pickupsAlive, 1);
  // A collector 3 m away with a 4 m magnet: the gem flies in at 12 m/s and is collected on touch.
  let collected = 0;
  let ticks = 0;
  while (h.pickups().length && ticks < 60) {
    out = h.step((i) => collector(i, 7 * M, 0, 4 * M));
    collected += out?.proxyScrap(0) ?? 0;
    ticks++;
  }
  assert.equal(collected, 3);
  assert.ok(ticks > 5 && ticks < 20, `collected after ${ticks} ticks`);
  assert.equal(out?.scrapCollected, 3);
  // Out of magnet range, a gem stays where it lies, forever.
  h.unit(6, -20 * M, 0);
  h.doom(6);
  h.step();
  for (let t = 0; t < 30; t++) h.step((i) => collector(i, 7 * M, 0, 4 * M));
  assert.equal(h.pickups().length, 1);
  assert.deepEqual(h.pickups()[0].slice(1, 3), h.pos(6));
});

test('drops beyond the free pickup slots join the carry and return as one merged gem near proxy 0: no scrap is lost', () => {
  const h = new SwarmHarness({ pickups: 4 }, { types: dropper(2) });
  for (let s = 0; s < 12; s++) {
    h.unit(s, Math.round(Math.cos(s / 2) * M), Math.round(Math.sin(s / 2) * M));
    h.doom(s);
  }
  let dropped = 0;
  let collected = 0;
  let sawCarry = 0;
  let sawMerged = 0;
  for (let t = 0; t < 80; t++) {
    const out = /** @type {import('../../engine/swarm/swarm-contract.js').SwarmOutbound} */ (h.step((i) => collector(i, 0, 0, 3 * M)));
    dropped += out.scrapDropped;
    collected += out.proxyScrap(0);
    const ground = h.pickups().reduce((sum, p) => sum + p[3], 0);
    assert.equal(dropped, collected + ground + out.scrapCarry + h.pendingDrops(), `tick ${t}: dropped = collected + on the ground + carried + pending`);
    sawCarry = Math.max(sawCarry, out.scrapCarry);
    for (const p of h.pickups()) sawMerged = Math.max(sawMerged, p[3]);
  }
  assert.equal(dropped, 24);
  assert.equal(sawCarry, 16, 'eight drops found no free slot');
  assert.equal(sawMerged, 16, 'and came back as one gem');
  assert.equal(collected, 24);
  assert.deepEqual(h.pickups(), []);
});

test('scrap the CPU deposits comes back as one gem 2 m north of proxy 0', () => {
  const h = new SwarmHarness();
  const out = h.step((i) => {
    i.proxy({ entity: 1, x: 3 * M, y: -M, radius: 512, team: Team.PLAYER });
    i.depositScrap(7);
  });
  assert.deepEqual(h.pickups(), [[0, 3 * M, M, 7]]);
  assert.equal(out?.scrapCarry, 0);
  const none = new SwarmHarness();
  const kept = none.step((i) => i.depositScrap(5)); // no proxy to put it near: it stays carried
  assert.equal(kept?.scrapCarry, 5);
  assert.deepEqual(none.pickups(), []);
});

test('a drop chance is a deterministic roll per tick and slot', () => {
  const run = () => {
    const h = new SwarmHarness({ units: 512, pickups: 512 }, { types: dropper(1, { dropChance: 16384 }) });
    for (let s = 0; s < 400; s++) {
      h.unit(s, ((s % 20) - 10) * M, (Math.floor(s / 20) - 10) * M);
      h.doom(s);
    }
    return /** @type {import('../../engine/swarm/swarm-contract.js').SwarmOutbound} */ (h.step()).scrapDropped;
  };
  const n = run();
  assert.ok(n > 60 && n < 140, `${n} of 400 deaths dropped at a 25 % chance`);
  assert.equal(run(), n);
});

test('an area effect hits the units inside its circle or ring: damage, kill credit and a radial impulse', () => {
  const h = new SwarmHarness();
  h.unit(0, M, 0, 0, 5000);
  h.unit(1, 0, 2560, 0, 5000);
  h.unit(2, 4 * M, 0, 0, 5000);
  h.unit(3, -M, 0, 0, 100);
  const out = /** @type {SwarmOutbound} */ (h.step((i) => i.effect({ x: 0, y: 0, radius: 3 * M, damage: 300, impulse: 200, source: 7 })));
  assert.deepEqual([h.hp(0), h.hp(1), h.hp(2)], [4700, 4700, 5000], 'inside the 3 m circle, not outside');
  assert.equal(h.alive(3), false);
  assert.equal(out.killsOfSource(7), 1, 'kill credit to the effect');
  assert.deepEqual([h.vel(0), h.vel(1), h.vel(2)], [[200, 0], [0, 200], [0, 0]], 'pushed away from the center');
  const r = new SwarmHarness();
  r.unit(0, M, 0, 0, 5000);
  r.unit(1, 2560, 0, 0, 5000);
  r.step((i) => i.effect({ shape: EffectShape.RING, x: 0, y: 0, radius: 3 * M, inner: 2 * M, damage: 300 }));
  assert.deepEqual([r.hp(0), r.hp(1)], [5000, 4700], 'a ring spares its inside');
});

test('knockback slides a unit and decays; heavy types take less, anchored ones none', () => {
  const h = new SwarmHarness({}, { types: [TEST_TYPES[0], TEST_TYPES[2], { ...TEST_TYPES[0], knockback: 255 }] });
  h.unit(0, 0, 0, 0);
  h.unit(1, 0, 8 * M, 1);
  h.unit(2, 0, -8 * M, 2);
  h.step((i) => {
    i.effect({ x: -M, y: 0, radius: 2 * M, impulse: 1000 });
    i.effect({ x: -M, y: 8 * M, radius: 2 * M, impulse: 1000 });
    i.effect({ x: -M, y: -8 * M, radius: 2 * M, impulse: 1000 });
  });
  assert.deepEqual(h.vel(0), [1000, 0]);
  assert.deepEqual(h.vel(1), [250, 0], 'knockback resistance 192 keeps a quarter');
  assert.deepEqual(h.vel(2), [0, 0], 'anchored');
  for (let t = 0; t < 30; t++) h.step();
  const [x] = h.pos(0);
  assert.ok(x > 2800 && x < 3100, `slid ${x} (the velocity decays by a quarter per tick)`);
  assert.deepEqual(h.vel(0), [0, 0]);
  assert.deepEqual(h.pos(2), [0, -8 * M]);
});

test('statuses: tiers merge by OR, timers step every 4 ticks with damage per step, immunities block', () => {
  const h = new SwarmHarness();
  h.unit(0, 0, 0, 0, 5000);
  h.unit(1, 0, 3 * M, 1, 5000); // the runner is immune to Stun
  h.step((i) => {
    i.effect({ x: 0, y: 0, radius: M, status: Status.BURNING, tier: 1 });
    i.effect({ x: 0, y: 0, radius: M, status: Status.BURNING, tier: 3 });
    i.effect({ x: 0, y: 3 * M, radius: M, status: Status.STUNNED, tier: 2 });
    i.effect({ x: 0, y: 3 * M, radius: M, status: Status.SLOWED, tier: 2 });
  });
  assert.equal(h.timer(0, Status.BURNING), 6, 'tier 3 wins');
  assert.equal(h.timer(1, Status.STUNNED), 0, 'immune');
  assert.equal(h.timer(1, Status.SLOWED), 8);
  while (h.tick <= 24) h.step();
  assert.equal(h.timer(0, Status.BURNING), 0);
  assert.equal(h.hp(0), 5000 - 6 * 64, 'six steps of burning');
  for (let t = 0; t < 8; t++) h.step();
  assert.equal(h.hp(0), 5000 - 6 * 64, 'and no more');
});

test('stunned units stop seeking and strike no one; slowed units move at half speed; marked ones take 25 % more', () => {
  const h = new SwarmHarness();
  h.unit(0, 6 * M, 0, 0, 5000);
  h.unit(1, -6 * M, 0, 0, 5000);
  h.unit(2, 0, 10 * M, 0, 5000);
  h.unit(3, 0, -10 * M, 0, 5000);
  const proxy = (/** @type {import('../../engine/swarm/swarm-contract.js').SwarmInbound} */ i) =>
    i.proxy({ entity: 1, x: 0, y: 0, radius: 512, team: Team.PLAYER });
  h.step((i) => {
    proxy(i);
    i.effect({ x: 6 * M, y: 0, radius: M, status: Status.STUNNED, tier: 3 });
    i.effect({ x: 0, y: 10 * M, radius: M, status: Status.SLOWED, tier: 3 });
  });
  for (let t = 0; t < 20; t++) h.step(proxy);
  // Tick 0 steered before its resolve applied the stun: the unit coasts to a stop within 0.1 m and holds.
  assert.ok(6 * M - h.pos(0)[0] < 100, `stunned: stopped after ${6 * M - h.pos(0)[0]}`);
  assert.deepEqual(h.vel(0), [0, 0]);
  assert.ok(h.pos(1)[0] > -6 * M + 900, 'the other one chases');
  const slow = 10 * M - h.pos(2)[1];
  const fast = h.pos(3)[1] + 10 * M;
  assert.ok(slow / fast > 0.4 && slow / fast < 0.6, `slowed ${slow} vs ${fast}`);

  const c = new SwarmHarness();
  c.unit(0, 0, 0, 0, 5000);
  let damage = 0;
  c.step((i) => {
    proxy(i);
    i.effect({ x: 0, y: 0, radius: M, status: Status.STUNNED, tier: 3 });
  });
  for (let t = 0; t < 25; t++) damage += c.step(proxy)?.proxyDamage(0) ?? 0;
  assert.equal(damage, 0, 'a stunned unit on the proxy deals no contact damage');
  for (let t = 0; t < 20; t++) damage += c.step(proxy)?.proxyDamage(0) ?? 0;
  assert.ok(damage > 0, 'until the stun wears off');

  const m = new SwarmHarness();
  m.unit(0, 0, 0, 0, 5000);
  m.step((i) => i.effect({ x: 0, y: 0, radius: M, status: Status.MARKED, tier: 1 }));
  m.step((i) => i.effect({ x: 0, y: 0, radius: M, damage: 400 }));
  assert.equal(m.hp(0), 5000 - 500);
});

test('report types emit UNIT_DIED events in canonical order; past the cap the class overflow bit is set', () => {
  const h = new SwarmHarness();
  for (const s of [9, 4, 6]) h.unit(s, s * M - 8 * M, 0, 2, 100);
  const out = /** @type {SwarmOutbound} */ (h.step((i) => i.effect({ x: -M, y: 0, radius: 6 * M, damage: 500, source: 5 })));
  assert.equal(out.events, 3);
  assert.equal(out.eventOverflow, 0);
  const slots = [];
  for (let k = 0; k < out.events; k++) {
    assert.equal(out.event(k, 0), EventKind.UNIT_DIED | (EventClass.GAMEPLAY << 8) | (2 << 16));
    assert.equal(out.event(k, 2), 5, 'credited source');
    slots.push(out.event(k, 1) & 0xffffff);
  }
  assert.deepEqual(slots, [4, 6, 9], 'sorted by record');
  const x = (out.event(0, 3) << 16) >> 16;
  assert.equal(x, (4 * M - 8 * M) >> 6, 'position in 1/16 m');

  const small = new SwarmHarness({ events: 2 });
  for (const s of [1, 2, 3]) small.unit(s, s * M, 0, 2, 100);
  const o = /** @type {SwarmOutbound} */ (small.step((i) => i.effect({ x: 2 * M, y: 0, radius: 4 * M, damage: 500 })));
  assert.equal(o.events, 2);
  assert.equal(o.eventOverflow, EventClass.GAMEPLAY);

  const layout = new SwarmLayout({ events: 4 });
  const block = new Int32Array(layout.L.outWords);
  block[OH.MAGIC] = OUT_MAGIC;
  block[OH.EVENTS] = 3;
  block.set([7, 0, 0, 0, -1, 0, 0, 0, 7, 0, 0, -5], layout.L.oEvents);
  SwarmOutbound.canonicalize(layout, block);
  assert.deepEqual(Array.from(block.subarray(layout.L.oEvents, layout.L.oEvents + 3 * EVENT_WORDS)), [7, 0, 0, 0, 7, 0, 0, -5, -1, 0, 0, 0], 'words compare unsigned');
});

/** A 32 × 32 grid of 2 m cells (origin −32 m) with a wall at column 18 (x 4..6 m), rows 12..19 (y −8..8 m). */
function walled() {
  const cost = new Uint8Array(32 * 32).fill(1);
  for (let cy = 12; cy < 20; cy++) cost[cy * 32 + 18] = 0;
  return cost;
}

test('flow fields: without one a unit stalls at a wall; with one it goes around, never entering a blocked cell', () => {
  const cost = walled();
  const proxy = (/** @type {import('../../engine/swarm/swarm-contract.js').SwarmInbound} */ i) =>
    i.proxy({ entity: 1, x: 10 * M, y: 0, radius: 512, team: Team.PLAYER });
  const stuck = new SwarmHarness({}, { cost });
  stuck.unit(0, -2 * M, 0, 1);
  for (let t = 0; t < 400; t++) stuck.step(proxy);
  assert.ok(stuck.pos(0)[0] < 4 * M, `straight seek stops at the wall (x ${stuck.pos(0)[0]})`);

  const h = new SwarmHarness({}, { cost });
  h.unit(0, -2 * M, 0, 1);
  const field = new FlowField(32, 32).solve(cost, 16 * 32 + 21); // the proxy's cell: (21, 16)
  let reached = -1;
  for (let t = 0; t < 600 && reached < 0; t++) {
    h.step((i) => {
      proxy(i);
      if (t === 0) i.setField(field);
    });
    const [x, y] = h.pos(0);
    const [cx, cy] = h.cell(x, y);
    assert.notEqual(cost[cy * 32 + cx], 0, `tick ${t}: inside a wall`);
    if (Math.hypot(x - 10 * M, y) < 2 * M) reached = t;
  }
  assert.ok(reached > 0, 'reaches the proxy around the wall');
});

test('walls stop shots', () => {
  const h = new SwarmHarness({}, { cost: walled() });
  h.unit(0, 8 * M, 0, 0, 5000);
  h.shot(0, { x: 2 * M, y: 0, vx: 600, vy: 0, dmg: 1000, life: 60 });
  for (let t = 0; t < 20; t++) h.step();
  assert.equal(h.shotAlive(0), false);
  assert.equal(h.hp(0), 5000, 'the unit behind the wall was not hit');
});

/** A busy scene: rings of all types, a pushing player proxy that fires every tick. */
function busy(/** @type {{ shuffle?: number }} */ o) {
  const h = new SwarmHarness({ units: 512, shots: 128 }, { seed: 777, shuffle: o.shuffle });
  const hashes = [];
  let scrap = 0;
  let events = 0;
  for (let t = 0; t < 240; t++) {
    const out = h.step((i) => {
      if (t % 40 === 0) i.spawnRing({ type: (t / 40) % 3, count: 60, cx: 0, cy: 0, r0: 8 * M, r1: 12 * M });
      i.proxy({ entity: 1, x: 0, y: 0, radius: 512, team: Team.PLAYER, flags: ProxyFlag.PUSHES | ProxyFlag.COLLECTOR, aux: 4 * M });
      if (t % 40 === 0) i.effect({ x: 0, y: 0, radius: 4 * M, impulse: 300, status: Status.STUNNED, tier: 1, source: 9 });
      if (t % 40 === 20) i.effect({ shape: EffectShape.RING, x: 0, y: 0, radius: 8 * M, inner: 3 * M, damage: 50, status: Status.BURNING, tier: 2, source: 10 });
      i.fire({ source: t % 5, x: 0, y: 0, range: 10 * M, damage: 700, speed: 600, life: 30, pierce: t % 2 });
    });
    hashes.push(h.ref.hash(), ...Array.from(/** @type {any} */ (out).block));
    scrap += out?.scrapCollected ?? 0;
    events += out?.events ?? 0;
  }
  return { hashes, h, scrap, events };
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
const GOLDEN_BUSY = 0x079d4807; // re-blessed for area effects, statuses and events in the busy scene

test('the busy scene matches its golden hash', () => {
  const { h, scrap, events } = busy({});
  assert.ok(scrap > 0, 'the scene drops and collects scrap, so the hash covers pickups');
  assert.ok(events > 0, 'brutes die and report, under stun and burning effects');
  assert.equal(h.ref.hash(), GOLDEN_BUSY, `got 0x${h.ref.hash().toString(16)}`);
});
