// @ts-check
// The per-thread side of the ECS: every participant (the engine thread and each job worker) builds one
// EcsEnv over the shared heap, with its own system instances, chunk view and command buffer.
// Chunk-parallel systems run through SystemChunkKernel: one job-queue item per ECS chunk of the
// dispatch list, each opening a command segment keyed (system ID, chunk index).
import { Kernel } from '../jobs/kernel.js';
import { ChunkView } from './chunk-view.js';
import { CommandWriter } from './command-buffer.js';
import { EcsReader } from './ecs-reader.js';

export class EcsEnv {
  /**
   * @param {import('../core/heap.js').Heap} heap a heap whose ECS arena a World has formatted
   * @param {import('./registry.js').Manifest} manifest
   * @param {number} participant 0 = engine thread, i + 1 = job worker i
   * @param {Record<string, any>} [resources] engine-thread services for systems; empty on job workers
   */
  constructor(heap, manifest, participant, resources = {}) {
    this.heap = heap;
    this.manifest = manifest;
    this.reader = new EcsReader(heap);
    if (participant >= this.reader.cmdParticipants) {
      throw new Error(`ecs: participant ${participant} has no command buffer (the World was formatted for ${this.reader.cmdParticipants})`);
    }
    this.participant = participant;
    this.writer = new CommandWriter(heap, this.reader.cmdW + participant * this.reader.cmdStride, this.reader.cmdStride);
    this.view = new ChunkView(heap);
    const ecs = { heap, reader: this.reader, participant, resources };
    this.systems = manifest.systems.map((S) => {
      const s = new S();
      s.init(ecs);
      return s;
    });
  }

  /**
   * Runs one system over chunks `[begin, end)` of the dispatch list.
   * @param {number} system system ID @param {number} listW word index of the chunk list
   * @param {number} begin @param {number} end
   */
  runChunks(system, listW, begin, end) {
    const i32 = this.heap.i32;
    const sys = this.systems[system];
    const view = this.view;
    const cmd = this.writer;
    for (let i = begin; i < end; i++) {
      view.reset(i32[listW + i], i);
      cmd.begin(system, i);
      try {
        sys.run(view, cmd);
      } catch (err) {
        cmd.abort();
        throw err;
      }
      cmd.end();
    }
  }
}

/** Runs a chunk-parallel system on any thread. args: [system ID, byte offset of the chunk list]. */
export class SystemChunkKernel extends Kernel {
  static key = 'ecs.system-chunks';

  /** @type {Kernel['run']} */
  run(ctx, args, begin, end) {
    /** @type {EcsEnv} */ (ctx.env).runChunks(args[0], args[1] >> 2, begin, end);
  }
}
