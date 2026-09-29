// @ts-check
// The ECS header at the start of the ECS arena, and read access to entities from any thread.
// The engine worker (World) formats and writes everything; job workers only read, and only while a
// stage runs, when no structural change can happen (docs/engine/02-core-ecs-jobs.md#thread-ownership).
import { FIELD_SHIFT, Field, FieldType } from './component.js';
import { ChunkView } from './chunk-view.js';

/** Word indices in the ECS header (relative to the start of the ECS arena). */
export const E = Object.freeze({
  MAGIC: 0,
  CAPACITY: 1,
  GEN_W: 2, // entity location table, one i32 column each: generation,
  ARCH_W: 3, // archetype ID,
  CHUNK_W: 4, // chunk byte offset,
  ROW_W: 5, // row
  FREE_W: 6, // FIFO ring of free entity indices
  FREE_HEAD: 7,
  FREE_TAIL: 8,
  CHUNK_BYTES: 9,
  POOL_OFF: 10,
  POOL_BLOCKS: 11,
  LIST_W: 12, // chunk dispatch list (one parallel system at a time)
  LIST_CAP: 13,
  CMD_W: 14, // command buffers, one per participant
  CMD_PARTICIPANTS: 15,
  CMD_STRIDE: 16,
  EPOCH: 17,
  CLOCK: 18,
  ALIVE: 19,
  REFUSED: 20,
  WORDS: 64,
});

export const ECS_MAGIC = 0x45435331; // 'ECS1'

/** Entity handles: index in bits 0-15, generation (1..65535) in bits 16-31. Handle 0 is null. */
export class Entity {
  static INDEX_BITS = 16;
  static INDEX_MASK = 0xffff;
  static MAX_CAPACITY = 1 << 16;

  /** @param {number} index @param {number} gen */
  static make(index, gen) {
    return ((gen << 16) | index) >>> 0;
  }

  /** @param {number} e */
  static index(e) {
    return e & 0xffff;
  }

  /** @param {number} e */
  static gen(e) {
    return e >>> 16;
  }
}

export class EcsReader {
  /** @param {import('../core/heap.js').Heap} heap */
  constructor(heap) {
    this.heap = heap;
    const i32 = heap.i32;
    const base = heap.arena('ecs').off >> 2;
    if (i32[base + E.MAGIC] !== ECS_MAGIC) throw new Error('ecs: the ECS arena is not formatted (create the World first)');
    this.base = base;
    this.capacity = i32[base + E.CAPACITY];
    this.genW = i32[base + E.GEN_W];
    this.archW = i32[base + E.ARCH_W];
    this.chunkW = i32[base + E.CHUNK_W];
    this.rowW = i32[base + E.ROW_W];
    this.listW = i32[base + E.LIST_W];
    this.cmdW = i32[base + E.CMD_W];
    this.cmdParticipants = i32[base + E.CMD_PARTICIPANTS];
    this.cmdStride = i32[base + E.CMD_STRIDE];
  }

  /** Whether a handle refers to a live entity. @param {number} e */
  alive(e) {
    const index = e & 0xffff;
    const gen = e >>> 16;
    const i32 = this.heap.i32;
    return gen !== 0 && index < this.capacity && i32[this.genW + index] === gen && i32[this.archW + index] >= 0;
  }

  /**
   * Element index of an entity's field in the view matching the field type, or -1 if the entity is
   * dead or lacks the component.
   * @param {number} e @param {number} field
   */
  elem(e, field) {
    if (!this.alive(e)) return -1;
    const index = e & 0xffff;
    const i32 = this.heap.i32;
    const chunk = i32[this.chunkW + index];
    const off = ChunkView.columnOffset(i32, chunk, field);
    if (off < 0) return -1;
    return ((chunk + off) >> FIELD_SHIFT[Field.type(field)]) + i32[this.rowW + index];
  }

  /** Whether a live entity has the component of a field. @param {number} e @param {number} field */
  has(e, field) {
    return this.elem(e, field) >= 0;
  }

  /**
   * Reads a field; `fallback` when the entity is dead or lacks the component.
   * @param {number} e @param {number} field @param {number} [fallback]
   */
  get(e, field, fallback = 0) {
    const at = this.elem(e, field);
    if (at < 0) return fallback;
    return EcsReader.read(this.heap, field, at);
  }

  /** @param {import('../core/heap.js').Heap} heap @param {number} field @param {number} at element index */
  static read(heap, field, at) {
    switch (Field.type(field)) {
      case FieldType.i32:
        return heap.i32[at];
      case FieldType.u16:
        return heap.u16[at];
      case FieldType.u8:
        return heap.u8[at];
      case FieldType.f32:
        return heap.f32[at];
      default:
        return heap.u32[at];
    }
  }

  /** @param {import('../core/heap.js').Heap} heap @param {number} field @param {number} at element index @param {number} value */
  static write(heap, field, at, value) {
    switch (Field.type(field)) {
      case FieldType.i32:
        heap.i32[at] = value;
        break;
      case FieldType.u16:
        heap.u16[at] = value;
        break;
      case FieldType.u8:
        heap.u8[at] = value;
        break;
      case FieldType.f32:
        heap.f32[at] = value;
        break;
      default:
        heap.u32[at] = value;
    }
  }
}
