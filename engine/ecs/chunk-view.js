// @ts-check
// ECS chunks (docs/engine/02-core-ecs-jobs.md#archetype-chunks) are fixed-size blocks whose header
// describes their own layout, so any thread can read one knowing only its offset.
//
// Header words (i32, from the chunk base):
//   0 archetype ID   1 count   2 capacity   3 sequence (creation order within the archetype)
//   4 column count   5 header words        6-7 reserved
//   8 + 3c: column c = [field handle (-1 for the entity column), byte offset from the chunk base, change tick]
// Column 0 always holds the entity handles.
import { FIELD_SHIFT, Field } from './component.js';

export const H = Object.freeze({ ARCH: 0, COUNT: 1, CAP: 2, SEQ: 3, COLS: 4, WORDS: 5, COL0: 8, COL_STRIDE: 3 });
/** Offsets inside a column record. */
export const C = Object.freeze({ FIELD: 0, OFF: 1, TICK: 2 });
/** Field value of the entity column. */
export const ENTITY_COLUMN = -1;

export class ChunkView {
  /** @param {import('../core/heap.js').Heap} heap */
  constructor(heap) {
    this.i32 = heap.i32;
    this.u32 = heap.u32;
    /** Byte offset of the chunk. */
    this.off = 0;
    /** Position of this chunk in the current dispatch list (the command-segment key). */
    this.index = 0;
    /** Live rows. */
    this.count = 0;
    this.#entities = 0;
  }

  #entities;

  /** @param {number} off chunk byte offset @param {number} index position in the dispatch list */
  reset(off, index) {
    const w = off >> 2;
    this.off = off;
    this.index = index;
    this.count = this.i32[w + H.COUNT];
    this.#entities = (off + this.i32[w + H.COL0 + C.OFF]) >> 2;
    return this;
  }

  /** Archetype ID of this chunk. */
  get archetype() {
    return this.i32[(this.off >> 2) + H.ARCH];
  }

  /** Entity handle at a row. @param {number} row */
  entity(row) {
    return this.u32[this.#entities + row];
  }

  /**
   * Index of row 0 of a field's column in the typed-array view matching the field type
   * (`heap.i32` for i32, `heap.u32` for u32 and entity, `heap.u16`, `heap.u8`, `heap.f32`).
   * @param {number} field field handle, e.g. `Health.hp`
   */
  col(field) {
    const off = ChunkView.columnOffset(this.i32, this.off, field);
    if (off < 0) throw new Error(`chunk has no column for field 0x${field.toString(16)}`);
    return (this.off + off) >> FIELD_SHIFT[Field.type(field)];
  }

  /** Whether this chunk's archetype has a field. @param {number} field */
  has(field) {
    return ChunkView.columnOffset(this.i32, this.off, field) >= 0;
  }

  /**
   * Marks a field's column as changed at `clock` (no-op if the chunk has no such column).
   * @param {Int32Array} i32 @param {number} chunkOff @param {number} field @param {number} clock
   */
  static stamp(i32, chunkOff, field, clock) {
    const w = chunkOff >> 2;
    const cols = i32[w + H.COLS];
    for (let c = 1; c < cols; c++) {
      const rec = w + H.COL0 + c * H.COL_STRIDE;
      if (i32[rec + C.FIELD] === field) i32[rec + C.TICK] = clock;
    }
  }

  /**
   * Change tick of a field's column, or -1 if the chunk has no such column.
   * @param {Int32Array} i32 @param {number} chunkOff @param {number} field
   */
  static tick(i32, chunkOff, field) {
    const w = chunkOff >> 2;
    const cols = i32[w + H.COLS];
    for (let c = 1; c < cols; c++) {
      const rec = w + H.COL0 + c * H.COL_STRIDE;
      if (i32[rec + C.FIELD] === field) return i32[rec + C.TICK];
    }
    return -1;
  }

  /**
   * Byte offset of a field's column from the chunk base, or -1.
   * @param {Int32Array} i32 @param {number} chunkOff @param {number} field
   */
  static columnOffset(i32, chunkOff, field) {
    const w = chunkOff >> 2;
    const cols = i32[w + H.COLS];
    for (let c = 1; c < cols; c++) {
      const rec = w + H.COL0 + c * H.COL_STRIDE;
      if (i32[rec + C.FIELD] === field) return i32[rec + C.OFF];
    }
    return -1;
  }
}
