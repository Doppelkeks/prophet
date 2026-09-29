// @ts-check
// Components (docs/engine/02-core-ecs-jobs.md#components). A component is a class with a static `key`
// (its manifest identity) and a static `schema` of typed fields. Each field gets a **field handle**, a
// small integer installed as a static on the class by the ComponentRegistry (for example `Health.hp`),
// which encodes the component ID, the field index and the field type.

/** Field type codes. `f32` is allowed only in render-only components. */
export const FieldType = Object.freeze({ i32: 0, u32: 1, entity: 2, u16: 3, u8: 4, f32: 5 });
/** Bytes per field type code. */
export const FIELD_BYTES = Object.freeze([4, 4, 4, 2, 1, 4]);
/** log2 of the field size: turns a byte offset into an index of the matching typed-array view. */
export const FIELD_SHIFT = Object.freeze([2, 2, 2, 1, 0, 2]);

/** @typedef {keyof typeof FieldType} FieldTypeName */

export class Component {
  /** Stable manifest key. Never derived from the class name (minification renames classes). */
  static key = '';
  /** @type {Record<string, FieldTypeName>} field name → type; empty for a tag */
  static schema = {};
  /** Render-only data may hold `f32`; sim systems may not read or write it. */
  static renderOnly = false;
  /** Component ID, installed by the ComponentRegistry. */
  static id = -1;
}

/** @typedef {typeof Component} ComponentClass */

/** Field handles: `componentId << 8 | fieldIndex << 3 | typeCode`. */
export class Field {
  static MAX_FIELDS = 32;

  /** @param {number} componentId @param {number} index @param {number} type */
  static make(componentId, index, type) {
    return (componentId << 8) | (index << 3) | type;
  }

  /** @param {number} field */
  static component(field) {
    return field >>> 8;
  }

  /** @param {number} field */
  static index(field) {
    return (field >>> 3) & 31;
  }

  /** @param {number} field */
  static type(field) {
    return field & 7;
  }
}
