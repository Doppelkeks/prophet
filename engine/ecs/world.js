// @ts-check
// The ECS world (docs/engine/02-core-ecs-jobs.md#ecs): archetype SoA chunks in the ECS arena, entity
// handles with generations, and the structural operations. Engine worker only; structural changes
// happen at sync points (the command applier) or at boot, never while a stage runs.
//
// ECS arena layout: header (E.WORDS words) | entity location table (4 columns) | free-index ring |
// chunk dispatch list | chunk pool (fixed-size blocks). Command buffers sit in the jobs arena.
import { PoolArena } from '../core/arenas.js';
import { Hash32 } from '../core/hash32.js';
import { JobQueue } from '../jobs/job-queue.js';
import { Archetype } from './archetype.js';
import { C, ChunkView, H } from './chunk-view.js';
import { FIELD_BYTES, FIELD_SHIFT } from './component.js';
import { E, ECS_MAGIC, EcsReader, Entity } from './ecs-reader.js';
import { Query } from './query.js';

/** @typedef {import('./component.js').ComponentClass} ComponentClass */
/** @typedef {import('./system.js').QueryDesc} QueryDesc */

/**
 * @typedef {object} WorldOptions
 * @property {number} [capacity] entity capacity, at most 65,536 (docs/BUDGETS.md#entity-caps)
 * @property {number} [chunkBytes] ECS chunk size, a multiple of 64
 * @property {number} [participants] threads that record commands: the engine thread plus job workers
 * @property {{ off: number, size: number }} [commandRegion] default: the jobs arena after the job queue
 */

export class World extends EcsReader {
  static DEFAULTS = Object.freeze({ capacity: 65536, chunkBytes: 16384, participants: 8 });

  /**
   * Formats the ECS arena and creates the empty archetype (ID 0).
   * @param {import('../core/heap.js').Heap} heap
   * @param {import('./registry.js').Manifest} manifest
   * @param {WorldOptions} [options]
   */
  constructor(heap, manifest, options = {}) {
    World.#format(heap, options);
    super(heap);
    this.manifest = manifest;
    this.registry = manifest.components;
    const i32 = heap.i32;
    this.chunkBytes = i32[this.base + E.CHUNK_BYTES];
    this.freeW = i32[this.base + E.FREE_W];
    this.listCap = i32[this.base + E.LIST_CAP];
    this.pool = new PoolArena({ off: i32[this.base + E.POOL_OFF], size: i32[this.base + E.POOL_BLOCKS] * this.chunkBytes }, this.chunkBytes);
    /** @type {Archetype[]} */
    this.archetypes = [];
    /** @type {Map<string, number>} */
    this.archetypeIds = new Map();
    this.archetypeOfIds([]);
  }

  /** The jobs arena after the job queue: the default home of the command buffers. @param {import('../core/heap.js').Heap} heap */
  static defaultCommandRegion(heap) {
    const jobs = heap.arena('jobs');
    const off = (jobs.off + JobQueue.bytes() + 63) & ~63;
    return { off, size: jobs.off + jobs.size - off };
  }

  /** @param {import('../core/heap.js').Heap} heap @param {WorldOptions} o */
  static #format(heap, o) {
    const capacity = o.capacity ?? World.DEFAULTS.capacity;
    const chunkBytes = o.chunkBytes ?? World.DEFAULTS.chunkBytes;
    const participants = o.participants ?? World.DEFAULTS.participants;
    if (capacity < 2 || capacity > Entity.MAX_CAPACITY) throw new Error(`ecs: entity capacity must be 2..${Entity.MAX_CAPACITY}`);
    if (chunkBytes % 64 !== 0 || chunkBytes < 1024) throw new Error('ecs: chunkBytes must be a multiple of 64, at least 1024');
    const i32 = heap.i32;
    const ecs = heap.arena('ecs');
    const base = ecs.off >> 2;
    let w = base + E.WORDS;
    const genW = w;
    const archW = (w += capacity);
    const chunkW = (w += capacity);
    const rowW = (w += capacity);
    const freeW = (w += capacity);
    const listW = (w += capacity);
    const listCap = Math.floor(ecs.size / chunkBytes);
    w += listCap;
    const poolOff = (w * 4 + 63) & ~63;
    const poolBlocks = Math.floor((ecs.off + ecs.size - poolOff) / chunkBytes);
    if (poolBlocks < 1) throw new Error('heap-arena-exhausted: the ECS arena has no room for chunks');

    const cmd = o.commandRegion ?? World.defaultCommandRegion(heap);
    const stride = Math.min(1 << 20, Math.floor(cmd.size / 4 / participants)) & ~15;
    if (cmd.off % 64 !== 0 || stride < 1024) throw new Error('ecs: the command region is misaligned or too small');
    const cmdW = cmd.off >> 2;

    i32.fill(0, base, base + E.WORDS);
    i32[base + E.CAPACITY] = capacity;
    i32[base + E.GEN_W] = genW;
    i32[base + E.ARCH_W] = archW;
    i32[base + E.CHUNK_W] = chunkW;
    i32[base + E.ROW_W] = rowW;
    i32[base + E.FREE_W] = freeW;
    i32[base + E.CHUNK_BYTES] = chunkBytes;
    i32[base + E.POOL_OFF] = poolOff;
    i32[base + E.POOL_BLOCKS] = poolBlocks;
    i32[base + E.LIST_W] = listW;
    i32[base + E.LIST_CAP] = listCap;
    i32[base + E.CMD_W] = cmdW;
    i32[base + E.CMD_PARTICIPANTS] = participants;
    i32[base + E.CMD_STRIDE] = stride;
    // Generations start at 1; index 0 is never handed out, so no live handle can equal null (0).
    i32.fill(1, genW, genW + capacity);
    i32[genW] = 0;
    i32.fill(-1, archW, archW + capacity);
    i32.fill(-1, chunkW, chunkW + capacity);
    i32.fill(-1, rowW, rowW + capacity);
    for (let k = 0; k < capacity - 1; k++) i32[freeW + k] = k + 1;
    i32[base + E.FREE_HEAD] = 0;
    i32[base + E.FREE_TAIL] = capacity - 1;
    for (let p = 0; p < participants; p++) i32[cmdW + p * stride] = 0;
    Atomics.store(i32, base + E.MAGIC, ECS_MAGIC);
  }

  // ---- counters -------------------------------------------------------------------------------

  /** Change clock: bumped once per system run and once per command apply. */
  get clock() {
    return this.heap.i32[this.base + E.CLOCK];
  }

  bumpClock() {
    const c = (this.heap.i32[this.base + E.CLOCK] + 1) | 0;
    this.heap.i32[this.base + E.CLOCK] = c;
    return c;
  }

  /** Bumped whenever archetypes or chunk lists change. */
  get epoch() {
    return this.heap.i32[this.base + E.EPOCH];
  }

  #bumpEpoch() {
    Atomics.add(this.heap.i32, this.base + E.EPOCH, 1);
  }

  /** Live entities. */
  get size() {
    return this.heap.i32[this.base + E.ALIVE];
  }

  /** Spawns refused because the entity capacity was reached. */
  get refused() {
    return this.heap.i32[this.base + E.REFUSED];
  }

  // ---- archetypes -----------------------------------------------------------------------------

  /** Gets or creates the archetype of a component set. @param {ComponentClass[]} components */
  archetype(components) {
    return this.archetypeOfIds(components.map((K) => this.registry.id(K)));
  }

  /** @param {number[]} ids component IDs, any order */
  archetypeOfIds(ids) {
    const sorted = [...new Set(ids)].sort((a, b) => a - b);
    const key = sorted.join(',');
    const known = this.archetypeIds.get(key);
    if (known !== undefined) return known;
    const id = this.archetypes.length;
    this.archetypes.push(new Archetype(id, sorted, this.registry, this.chunkBytes));
    this.archetypeIds.set(key, id);
    this.#bumpEpoch();
    return id;
  }

  /** Archetype ID of a live entity, or -1. @param {number} e */
  archetypeOf(e) {
    return this.alive(e) ? this.heap.i32[this.archW + (e & 0xffff)] : -1;
  }

  /** @param {Archetype} arch @param {number} componentId @param {boolean} add */
  #edge(arch, componentId, add) {
    const key = add ? componentId + 1 : -(componentId + 1);
    let id = arch.edges.get(key);
    if (id === undefined) {
      id = this.archetypeOfIds(add ? [...arch.components, componentId] : arch.components.filter((c) => c !== componentId));
      arch.edges.set(key, id);
    }
    return id;
  }

  // ---- structural operations (engine thread, outside stages) ----------------------------------

  /**
   * Creates an entity with zeroed fields. Returns 0 (null) when the entity capacity is reached.
   * Indices come from a FIFO free list, so the same sequence of operations yields the same handles.
   * @param {number} archetypeId
   */
  spawn(archetypeId) {
    const i32 = this.heap.i32;
    const base = this.base;
    if (i32[base + E.ALIVE] >= this.capacity - 1) {
      i32[base + E.REFUSED]++;
      return 0;
    }
    const arch = this.archetypes[archetypeId];
    if (!arch) throw new Error(`ecs: unknown archetype ${archetypeId}`);
    const head = i32[base + E.FREE_HEAD];
    const index = i32[this.freeW + head];
    i32[base + E.FREE_HEAD] = (head + 1) % this.capacity;
    i32[base + E.ALIVE]++;
    const e = Entity.make(index, i32[this.genW + index]);
    this.#insertRow(arch, e);
    return e;
  }

  /** Destroys an entity; false (a no-op) if the handle is stale. @param {number} e */
  despawn(e) {
    if (!this.alive(e)) return false;
    const i32 = this.heap.i32;
    const index = e & 0xffff;
    this.#removeRow(this.archetypes[i32[this.archW + index]], i32[this.chunkW + index], i32[this.rowW + index]);
    const gen = (e >>> 16) + 1;
    i32[this.genW + index] = gen > 0xffff ? 1 : gen;
    i32[this.archW + index] = -1;
    i32[this.chunkW + index] = -1;
    i32[this.rowW + index] = -1;
    const tail = i32[this.base + E.FREE_TAIL];
    i32[this.freeW + tail] = index;
    i32[this.base + E.FREE_TAIL] = (tail + 1) % this.capacity;
    i32[this.base + E.ALIVE]--;
    return true;
  }

  /**
   * Adds a component (moving the row to another archetype), or overwrites its values if present.
   * @param {number} e @param {ComponentClass} K @param {ArrayLike<number> | null} [values] one per field, in schema order
   */
  add(e, K, values = null) {
    return this.addId(e, this.registry.id(K), values);
  }

  /** @param {number} e @param {number} componentId @param {ArrayLike<number> | null} [values] */
  addId(e, componentId, values = null) {
    if (!this.alive(e)) return false;
    const src = this.archetypes[this.heap.i32[this.archW + (e & 0xffff)]];
    if (!src.has(componentId)) this.#move(e, src, this.archetypes[this.#edge(src, componentId, true)]);
    if (values) {
      const fields = this.registry.fields[componentId];
      for (let f = 0; f < fields.length; f++) this.set(e, fields[f].handle, f < values.length ? values[f] : 0);
    }
    return true;
  }

  /** Removes a component; a no-op if absent. @param {number} e @param {ComponentClass} K */
  remove(e, K) {
    return this.removeId(e, this.registry.id(K));
  }

  /** @param {number} e @param {number} componentId */
  removeId(e, componentId) {
    if (!this.alive(e)) return false;
    const src = this.archetypes[this.heap.i32[this.archW + (e & 0xffff)]];
    if (!src.has(componentId)) return false;
    this.#move(e, src, this.archetypes[this.#edge(src, componentId, false)]);
    return true;
  }

  /**
   * Writes one field of any entity; false (a no-op) if the entity is dead or lacks the component.
   * @param {number} e @param {number} field @param {number} value
   */
  set(e, field, value) {
    if (!this.alive(e)) return false;
    const i32 = this.heap.i32;
    const index = e & 0xffff;
    const arch = this.archetypes[i32[this.archW + index]];
    const col = arch.fieldColumn.get(field);
    if (col === undefined) return false;
    const chunk = i32[this.chunkW + index];
    EcsReader.write(this.heap, field, ((chunk + arch.offsets[col]) >> FIELD_SHIFT[arch.types[col]]) + i32[this.rowW + index], value);
    i32[(chunk >> 2) + H.COL0 + col * H.COL_STRIDE + C.TICK] = this.clock;
    return true;
  }

  /** Whether a live entity has a component. @param {number} e @param {ComponentClass} K */
  hasComponent(e, K) {
    return this.alive(e) && this.archetypes[this.heap.i32[this.archW + (e & 0xffff)]].has(this.registry.id(K));
  }

  // ---- rows -----------------------------------------------------------------------------------

  /** @param {Archetype} arch @param {number} e */
  #insertRow(arch, e) {
    const i32 = this.heap.i32;
    let chunk = -1;
    for (let k = 0; k < arch.chunks.length; k++) {
      if (i32[(arch.chunks[k] >> 2) + H.COUNT] < arch.capacity) {
        chunk = arch.chunks[k];
        break;
      }
    }
    if (chunk < 0) chunk = this.#newChunk(arch);
    const w = chunk >> 2;
    const row = i32[w + H.COUNT];
    i32[w + H.COUNT] = row + 1;
    const clock = this.clock;
    for (let col = 0; col < arch.types.length; col++) {
      this.#zero(chunk + arch.offsets[col], arch.types[col], row);
      i32[w + H.COL0 + col * H.COL_STRIDE + C.TICK] = clock;
    }
    this.heap.u32[((chunk + arch.offsets[0]) >> 2) + row] = e;
    const index = e & 0xffff;
    i32[this.archW + index] = arch.id;
    i32[this.chunkW + index] = chunk;
    i32[this.rowW + index] = row;
    return row;
  }

  /** Swap-removes a row: the chunk's last row fills the hole and its entity's location is patched. @param {Archetype} arch @param {number} chunk @param {number} row */
  #removeRow(arch, chunk, row) {
    const i32 = this.heap.i32;
    const w = chunk >> 2;
    const last = i32[w + H.COUNT] - 1;
    if (row !== last) {
      for (let col = 0; col < arch.types.length; col++) {
        const colOff = chunk + arch.offsets[col];
        this.#copy(colOff, last, colOff, row, arch.types[col]);
      }
      const moved = this.heap.u32[((chunk + arch.offsets[0]) >> 2) + row];
      i32[this.rowW + (moved & 0xffff)] = row;
    }
    i32[w + H.COUNT] = last;
    if (last === 0) {
      arch.chunks.splice(arch.chunks.indexOf(chunk), 1);
      this.pool.release(chunk);
      this.#bumpEpoch();
    }
  }

  /** Moves an entity's row to another archetype, keeping the fields both have. @param {number} e @param {Archetype} src @param {Archetype} dst */
  #move(e, src, dst) {
    const i32 = this.heap.i32;
    const index = e & 0xffff;
    const srcChunk = i32[this.chunkW + index];
    const srcRow = i32[this.rowW + index];
    const dstRow = this.#insertRow(dst, e);
    const dstChunk = i32[this.chunkW + index];
    for (let col = 1; col < dst.fields.length; col++) {
      const from = src.fieldColumn.get(dst.fields[col]);
      if (from !== undefined) this.#copy(srcChunk + src.offsets[from], srcRow, dstChunk + dst.offsets[col], dstRow, dst.types[col]);
    }
    this.#removeRow(src, srcChunk, srcRow);
  }

  /** @param {Archetype} arch */
  #newChunk(arch) {
    const off = this.pool.alloc();
    if (off < 0) throw new Error('heap-arena-exhausted: no free ECS chunk');
    const i32 = this.heap.i32;
    const w = off >> 2;
    i32.fill(0, w, w + arch.headerWords);
    i32[w + H.ARCH] = arch.id;
    i32[w + H.COUNT] = 0;
    i32[w + H.CAP] = arch.capacity;
    i32[w + H.SEQ] = arch.nextSeq++;
    i32[w + H.COLS] = arch.fields.length;
    i32[w + H.WORDS] = arch.headerWords;
    for (let col = 0; col < arch.fields.length; col++) {
      const rec = w + H.COL0 + col * H.COL_STRIDE;
      i32[rec + C.FIELD] = arch.fields[col];
      i32[rec + C.OFF] = arch.offsets[col];
      i32[rec + C.TICK] = this.clock;
    }
    arch.chunks.push(off);
    this.#bumpEpoch();
    return off;
  }

  /** @param {number} colOff byte offset of the column @param {number} type @param {number} row */
  #zero(colOff, type, row) {
    const h = this.heap;
    const size = FIELD_BYTES[type];
    if (size === 4) h.i32[(colOff >> 2) + row] = 0;
    else if (size === 2) h.u16[(colOff >> 1) + row] = 0;
    else h.u8[colOff + row] = 0;
  }

  /** @param {number} fromCol @param {number} fromRow @param {number} toCol @param {number} toRow @param {number} type */
  #copy(fromCol, fromRow, toCol, toRow, type) {
    const h = this.heap;
    const size = FIELD_BYTES[type];
    if (size === 4) h.i32[(toCol >> 2) + toRow] = h.i32[(fromCol >> 2) + fromRow];
    else if (size === 2) h.u16[(toCol >> 1) + toRow] = h.u16[(fromCol >> 1) + fromRow];
    else h.u8[toCol + toRow] = h.u8[fromCol + fromRow];
  }

  // ---- queries and iteration ------------------------------------------------------------------

  /** @param {QueryDesc} desc */
  query(desc) {
    return new Query(this, desc);
  }

  /**
   * Marks the given fields as written in every listed chunk (a system with write access visited them).
   * @param {number} listW word index of the chunk list @param {number} count @param {number[]} fields @param {number} clock
   */
  stampChunks(listW, count, fields, clock) {
    const i32 = this.heap.i32;
    for (let i = 0; i < count; i++) for (const f of fields) ChunkView.stamp(i32, i32[listW + i], f, clock);
  }

  /** Live entities matching a query, in iteration order (archetype ID, chunk sequence, row). Tests and tools. @param {QueryDesc} [desc] */
  entities(desc = {}) {
    const out = [];
    const view = new ChunkView(this.heap);
    for (const chunk of this.query(desc).chunkList()) {
      view.reset(chunk, 0);
      for (let r = 0; r < view.count; r++) out.push(view.entity(r));
    }
    return out;
  }

  /**
   * State hash over every live entity in iteration order: handle, archetype and every field that is
   * not render-only (docs/engine/09-determinism-coop.md#replays-and-hashes).
   * @param {number} [seed]
   */
  hash(seed = 0) {
    const h32 = this.heap.i32;
    let h = Hash32.begin(seed);
    let words = 0;
    for (const arch of this.archetypes) {
      if (!arch.chunks.length) continue;
      h = Hash32.step(h, arch.id);
      words++;
      for (const chunk of arch.chunks) {
        const n = h32[(chunk >> 2) + H.COUNT];
        for (let col = 0; col < arch.fields.length; col++) {
          if (arch.renderOnly[col]) continue;
          const type = arch.types[col];
          const size = FIELD_BYTES[type];
          const at = (chunk + arch.offsets[col]) >> FIELD_SHIFT[type];
          const view = size === 4 ? this.heap.u32 : size === 2 ? this.heap.u16 : this.heap.u8;
          for (let r = 0; r < n; r++) h = Hash32.step(h, view[at + r]);
          words += n;
        }
      }
    }
    return Hash32.end(Hash32.step(h, this.size), words + 1);
  }
}
