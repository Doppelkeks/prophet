// PATCH's demo abilities as swarm area effects: the stomp on dash, Overclock with its meter and pulse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SimBoot } from '../../engine/app/sim-boot.js';
import { Heap } from '../../engine/core/heap.js';
import { Buttons, InputRecord } from '../../engine/input/input-record.js';
import { SwarmReference } from '../../engine/swarm/reference/swarm-reference.js';
import { SCRAPWAKE } from '../../game/app/game.js';
import { Abilities, Motion } from '../../game/components/index.js';
import { PATCH_SPEED } from '../../game/data/arena.js';
import { OVERCLOCK, STOMP } from '../../game/data/abilities.js';

async function boot() {
  return SimBoot.create({
    game: SCRAPWAKE,
    heap: Heap.create('test', false),
    tier: 'inline',
    swarm: (layout, tables, seed) => new SwarmReference(layout, tables, { seed }),
    swarmProfile: 'test',
  });
}

/** @param {import('../../engine/app/sim-core.js').SimCore} sim @param {number} buttons @param {number} [mx] */
async function tick(sim, buttons, mx = 0) {
  const [w0, w1] = InputRecord.pack(mx, 0, 0, buttons, 0, 0);
  sim.stamp(w0, w1);
  assert.equal(await sim.step(), true);
  return /** @type {import('../../engine/swarm/swarm-contract.js').SwarmInbound} */ (sim.resources.swarm).effects;
}

test('holding dash stomps whenever the stomp is ready: a 3 m effect, then the cooldown', async () => {
  const b = await boot();
  const sim = b.sim;
  const patch = sim.resources.patch;
  assert.equal(await tick(sim, Buttons.DASH), 1, 'the first tick stomps');
  assert.equal(sim.world.get(patch, Abilities.stompCd), STOMP.cooldown);
  let stomps = 1;
  for (let t = 1; t <= STOMP.cooldown; t++) stomps += await tick(sim, Buttons.DASH);
  assert.equal(stomps, 2, 'once more when the cooldown ran out');
  await b.jobs.shutdown();
});

test('Overclock: the meter fills; a fresh press with a full meter pulses once and speeds PATCH up', async () => {
  const b = await boot();
  const sim = b.sim;
  const patch = sim.resources.patch;
  for (let t = 0; t < 60; t++) await tick(sim, 0);
  assert.ok(sim.world.get(patch, Abilities.energy) >= 10, 'ten points in a second, plus kills');
  assert.equal(await tick(sim, Buttons.OVERCLOCK), 0, 'not before the meter is full');
  while (sim.world.get(patch, Abilities.energy) < OVERCLOCK.full) await tick(sim, 0);
  assert.equal(await tick(sim, Buttons.OVERCLOCK), 1, 'a fresh press: the pulse');
  assert.equal(sim.world.get(patch, Abilities.energy), 0);
  assert.equal(await tick(sim, Buttons.OVERCLOCK), 0, 'holding the button does nothing more');
  await tick(sim, 0, 127);
  assert.equal(sim.world.get(patch, Motion.vx), Math.trunc((PATCH_SPEED * 6) / 5), '+20 % move speed');
  for (let t = 0; t < OVERCLOCK.duration; t++) await tick(sim, 0);
  await tick(sim, 0, 127);
  assert.equal(sim.world.get(patch, Motion.vx), PATCH_SPEED, 'and back after 5 s');
  await b.jobs.shutdown();
});
