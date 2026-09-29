// @ts-check
// Replay documents (docs/engine/09-determinism-coop.md#replays-and-hashes): the run's header, its command
// log and its hash stream. The engine worker exports one from a live run. `Replay.run` plays it back
// headless (Node, or any thread without a GPU) with the JS reference swarm, and must reproduce the hash
// stream exactly: that is the end-to-end check that the GPU swarm matches the reference.
import { Heap } from '../core/heap.js';
import { CommandLog } from '../input/command-log.js';
import { SwarmReference } from '../swarm/reference/swarm-reference.js';
import { SimBoot } from './sim-boot.js';

/**
 * @typedef {object} ReplayHeader everything besides the log that decides the results (the sim profile)
 * @property {number} build manifest hash of the game that recorded it
 * @property {import('../core/heap.js').HeapProfile} heapProfile heap profile the sim ran with
 * @property {number} seed the swarm's run seed
 * @property {number} K swarm latency in ticks
 * @property {import('../swarm/swarm-layout.js').SwarmCaps | null} swarmCaps the swarm's full caps; null without a swarm
 * @property {number} hashEvery state-hash interval in ticks
 */

/**
 * @typedef {ReplayHeader & {
 *   version: number,
 *   ticks: number,
 *   log: { version: number, ticks: number, words: number[], ui?: number[] },
 *   hashes: number[],
 * }} ReplayDocument `hashes` holds flat [tick, hash] pairs
 */

export class Replay {
  static VERSION = 1;

  /**
   * The run so far as a replay document.
   * @param {import('./sim-core.js').SimCore} sim @param {ReplayHeader} header
   * @returns {ReplayDocument}
   */
  static document(sim, header) {
    return { version: Replay.VERSION, ...header, ticks: sim.tick, log: sim.log.toJSON(), hashes: sim.hashes.slice() };
  }

  /**
   * Plays a document back with the reference swarm and compares the hash streams.
   * @param {import('./game-module.js').GameModule} game
   * @param {ReplayDocument} doc
   * @returns {Promise<{ ticks: number, hashes: number[], mismatch: { tick: number, expected: number, actual: number } | null }>}
   */
  static async run(game, doc) {
    if (doc.version !== Replay.VERSION) throw new Error(`replay: unsupported version ${doc.version}`);
    const gs = game.swarm;
    if (doc.swarmCaps && (!gs || gs.seed !== doc.seed || gs.K !== doc.K)) throw new Error('replay: the game module does not match the recorded swarm (seed or K)');
    const boot = await SimBoot.create({
      game,
      heap: Heap.create(doc.heapProfile, false),
      tier: 'inline',
      log: CommandLog.fromJSON(doc.log),
      hashEvery: doc.hashEvery,
      swarm: doc.swarmCaps ? (layout, tables, seed) => new SwarmReference(layout, tables, { seed }) : undefined,
      swarmCaps: doc.swarmCaps ?? undefined,
    });
    if (boot.manifest.hash !== doc.build) {
      throw new Error(`replay: recorded by build ${doc.build.toString(16)}, this is ${boot.manifest.hash.toString(16)}`);
    }
    const sim = boot.sim;
    await sim.replay(doc.ticks);
    let mismatch = null;
    const n = Math.max(sim.hashes.length, doc.hashes.length);
    for (let i = 0; i < n; i += 2) {
      if (sim.hashes[i] !== doc.hashes[i] || sim.hashes[i + 1] !== doc.hashes[i + 1]) {
        mismatch = { tick: doc.hashes[i] ?? sim.hashes[i], expected: doc.hashes[i + 1], actual: sim.hashes[i + 1] };
        break;
      }
    }
    await boot.jobs.shutdown();
    return { ticks: sim.tick, hashes: sim.hashes, mismatch };
  }
}
