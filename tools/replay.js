// Node tool: replays a SCRAPWAKE replay document (window.__px.exportReplay() in a dev build) with
// the JS reference swarm, and checks its hash stream (docs/engine/09-determinism-coop.md#replays-and-hashes).
//   npm run replay -- run.json      exit 0: identical, 1: diverged, 2: unusable file
// Like the other tools it runs in Node only, so it is not part of the browser typecheck.
import '../engine/core/dev-global.js';
import { readFile } from 'node:fs/promises';
import { Replay } from '../engine/app/replay.js';
import { SCRAPWAKE } from '../game/app/game.js';

const file = process.argv[2];
if (!file) {
  console.error('usage: npm run replay -- <replay.json>');
  process.exit(2);
}
try {
  const doc = JSON.parse(await readFile(file, 'utf8'));
  const t0 = performance.now();
  const r = await Replay.run(SCRAPWAKE, doc);
  const ms = Math.round(performance.now() - t0);
  if (r.tainted) console.warn('warning: the run lost swarm events (overflow); it cannot replay exactly');
  if (r.mismatch) {
    const hex = (/** @type {number | undefined} */ h) => (h === undefined ? 'none' : (h >>> 0).toString(16).padStart(8, '0'));
    console.error(`DIVERGED at tick ${r.mismatch.tick}: recorded ${hex(r.mismatch.expected)}, replayed ${hex(r.mismatch.actual)}`);
    process.exit(1);
  }
  console.log(`identical: ${r.ticks} ticks, ${r.hashes.length / 2} hashes (${ms} ms)`);
} catch (err) {
  console.error(`replay failed: ${err instanceof Error ? err.message : err}`);
  process.exit(2);
}
