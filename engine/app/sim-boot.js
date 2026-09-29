// @ts-check
// Builds a running simulation from a game module: heap plan, manifest, world, per-thread ECS env, job
// system, scheduler, SimCore, then the game's setup. Used by the engine worker and by Node replays.
import { EcsEnv } from '../ecs/ecs-env.js';
import { Manifest } from '../ecs/registry.js';
import { Scheduler } from '../ecs/scheduler.js';
import { World } from '../ecs/world.js';
import { JobSystem } from '../jobs/job-system.js';
import { HeapPlan } from './heap-plan.js';
import { SimCore } from './sim-core.js';

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
    const sim = new SimCore({ world, scheduler, resources, log: o.log, hashEvery: o.hashEvery });
    o.game.setup(sim);
    return { sim, plan, jobs, manifest, world, workers };
  }
}
