// @ts-check
// What a game gives the renderer: data only, so game modules can import it in Node (replays, tests).

/** Words per actor record: x, y, z (Q10 m), vx, vy (Q10 m per tick), style index, 2 spare. */
export const ACTOR_WORDS = 8;

/**
 * A box in internal pixels (docs/engine/04-pixel-art-pipeline.md#projection): width along x, depth along y,
 * height along z, lifted z px off its base. Colors are palette tokens (`--c-<token>` in the palette CSS).
 * @typedef {{ w: number, d: number, h: number, z?: number, top: string, front: string }} BoxStyle
 */

/**
 * @typedef {object} RenderStyle
 * @property {string} palette path of the CSS file that defines the `--c-*: #RRGGBB;` tokens
 * @property {string} clear token of the clear color
 * @property {{ a: string, b: string, edge: string, outside: string, tile: number }} ground checker tokens, tile in meters
 * @property {BoxStyle[]} units per swarm type (at most 16)
 * @property {BoxStyle[]} actors actor styles (at most 16), picked by the actor record's style word
 * @property {BoxStyle} shot
 * @property {BoxStyle} pickup scrap gems
 * @property {number} arenaHalf meters
 * @property {number} [lift] meters above the followed actor that the camera centers on
 * @property {number} [maxActors] actor records per frame (default 64)
 */

export {};
