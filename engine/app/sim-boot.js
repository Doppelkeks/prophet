// @ts-check
// Builds a running simulation from a game module: heap plan, manifest, world, per-thread ECS env, job
// system, scheduler, SimCore, then the game's setup. Used by the engine worker and by Node replays.
import { EcsEnv } from '../ecs/ecs-env.js';
import { Manifest } from '../ecs/registry.js';
import { Scheduler } from '../ecs/scheduler.js';
import { World } from '../ecs/world.js';
import { JobSystem } from '../jobs/job-system.js';
import { SwarmTables } from '../swarm/swarm-contract.js';
import { SwarmLayout } from '../swarm/swarm-layout.js';
import { HeapPlan } from './heap-plan.js';
import { SimCore } from './sim-core.js';

/**
 * Builds the swarm implementation for a layout: the GPU `Swarm` in the engine worker, `SwarmReference`
 * in Node and tests.
 * @typedef {(layout: SwarmLayout, tables: Int32Array, seed: number) => import('../swarm/swarm-backend.js').SwarmBackend | Promise<import('../swarm/swarm-backend.js').SwarmBackend>} SwarmFactory
 */

export class SimBoot {
  /**
   * @param {{
   *   game: import('./game-module.js').GameModule,
   *   heap: import('../core/heap.js').Heap,
   *   tier: import('../platform/tiers.js').ThreadingTier,
   *   workers?: number,
   *   spawn?: (index: number) => import('../jobs/worker-port.js').WorkerHandle,
   *   log?: import('../input/command-log.js').CommandLog,
   *   hashEvery?: number,
   *   parallel?: 'auto' | 'always' | 'never',
   *   swarm?: SwarmFactory,
   *   swarmProfile?: string,
   *   swarmCaps?: Partial<import('../swarm/swarm-layout.js').SwarmCaps>,
   * }} o
   */
  static async create(o) {
    const plan = HeapPlan.carve(o.heap, o.game.hud.bytes);
    const manifest = new Manifest(o.game.manifest);
    const workers = o.tier === 'inline' ? 0 : (o.workers ?? 0);
    const world = new World(o.heap, manifest, { participants: workers + 1, commandRegion: plan.commands });
    /** @type {Record<string, any>} */
    const resources = {};
    const env = new EcsEnv(o.heap, manifest, 0, resources);
    const jobs = await JobSystem.create({ tier: o.tier, heap: o.heap, registry: manifest.kernels, workers, spawn: o.spawn, env, region: plan.queue });
    const scheduler = new Scheduler({ world, env, jobs, parallel: o.parallel });
    const gs = o.game.swarm;
    /** @type {import('./sim-core.js').SwarmLink | null} */
    let swarm = null;
    if (gs && o.swarm) {
      const layout = new SwarmLayout({ ...gs.caps(o.swarmProfile ?? 'std'), ...o.swarmCaps });
      swarm = { backend: await o.swarm(layout, SwarmTables.build(layout, gs.types), gs.seed), K: gs.K };
    }
    const sim = new SimCore({ world, scheduler, resources, log: o.log, hashEvery: o.hashEvery, swarm });
    o.game.setup(sim);
    return { sim, plan, jobs, manifest, world, workers, swarm };
  }
}
