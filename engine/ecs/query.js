// @ts-check
// Queries (docs/engine/02-core-ecs-jobs.md#queries): `{ all, none, any, changed }` compiled against
// archetype signatures. Matches are cached and only appended to, because archetypes are never destroyed.
// Iteration order is fixed: archetype ID, then chunk sequence, then row.
import { ChunkView, H } from './chunk-view.js';

/** @typedef {import('./system.js').QueryDesc} QueryDesc */
/** @typedef {import('./archetype.js').Archetype} Archetype */

export class Query {
  /**
   * @param {import('./world.js').World} world
   * @param {QueryDesc} desc
   */
  constructor(world, desc) {
    this.world = world;
    const reg = world.registry;
    this.all = (desc.all ?? []).map((K) => reg.id(K));
    this.none = (desc.none ?? []).map((K) => reg.id(K));
    this.any = (desc.any ?? []).map((K) => reg.id(K));
    /** Field handles whose change ticks the `changed` filter compares. */
    this.changedFields = /** @type {number[]} */ ([]);
    for (const K of desc.changed ?? []) {
      const fields = reg.fields[reg.id(K)];
      if (!fields.length) throw new Error(`query: tag ${K.key} has no columns, so it can't be in 'changed'`);
      for (const f of fields) this.changedFields.push(f.handle);
    }
    /** @type {number[]} matching archetype IDs, ascending */
    this.matches = [];
    this.#seen = 0;
  }

  #seen;

  /** @param {Archetype} a */
  test(a) {
    for (const c of this.all) if (!a.has(c)) return false;
    for (const c of this.none) if (a.has(c)) return false;
    if (this.any.length && !this.any.some((c) => a.has(c))) return false;
    return true;
  }

  /** Matching archetype IDs, including archetypes created since the last call. */
  archetypes() {
    const list = this.world.archetypes;
    for (; this.#seen < list.length; this.#seen++) if (this.test(list[this.#seen])) this.matches.push(this.#seen);
    return this.matches;
  }

  /**
   * Writes the offsets of the matching chunks, in iteration order, to `i32[listW ..]`.
   * With a `changed` filter, only chunks where one of those columns changed after `since` are listed.
   * @param {number} since change clock of the system's previous run (-1 = everything)
   * @param {Int32Array} i32 @param {number} listW @param {number} cap
   * @returns {number} chunks listed
   */
  collect(since, i32, listW, cap) {
    let n = 0;
    for (const id of this.archetypes()) {
      for (const chunk of this.world.archetypes[id].chunks) {
        if (this.changedFields.length && !this.#changedSince(i32, chunk, since)) continue;
        if (n >= cap) throw new Error('ecs: the chunk dispatch list is full');
        i32[listW + n++] = chunk;
      }
    }
    return n;
  }

  /** The matching chunks as an array (tools and tests). @param {number} [since] */
  chunkList(since = -1) {
    const i32 = this.world.heap.i32;
    const out = [];
    for (const id of this.archetypes()) {
      for (const chunk of this.world.archetypes[id].chunks) if (!this.changedFields.length || this.#changedSince(i32, chunk, since)) out.push(chunk);
    }
    return out;
  }

  /** Live entities matching the query (ignores `changed`). */
  count() {
    const i32 = this.world.heap.i32;
    let n = 0;
    for (const id of this.archetypes()) for (const chunk of this.world.archetypes[id].chunks) n += i32[(chunk >> 2) + H.COUNT];
    return n;
  }

  /** @param {Int32Array} i32 @param {number} chunk @param {number} since */
  #changedSince(i32, chunk, since) {
    for (const f of this.changedFields) if (ChunkView.tick(i32, chunk, f) > since) return true;
    return false;
  }
}
