// @ts-check
// What a game hands the engine. The same module runs in the engine worker and in Node (replays), so
// it must not touch the DOM, the GPU or the clock.

/**
 * @typedef {object} FrameStats per-frame numbers for the HUD
 * @property {number} fps
 * @property {number} frameMs
 * @property {number} simMs
 * @property {number} ticks ticks run this frame
 * @property {number} skipped frames skipped because the previous one was still running
 * @property {number} [readbackP95] ms from submit to harvest (GPU swarm)
 */

/**
 * @typedef {object} GameSwarm
 * @property {number} K GPU→CPU latency in ticks
 * @property {number} seed run seed of the swarm's RNG streams
 * @property {import('../swarm/swarm-contract.js').UnitType[]} types the type table
 * @property {(profile: string) => Partial<import('../swarm/swarm-layout.js').SwarmCaps>} caps pool sizes per heap profile
 */

/**
 * @typedef {object} GameModule
 * @property {import('../ecs/registry.js').ManifestSpec} manifest
 * @property {import('../ui/state-block.js').StateSchema} hud layout of the UI state block
 * @property {GameSwarm} [swarm] the GPU swarm, if the game has one
 * @property {(sim: import('./sim-core.js').SimCore) => void} setup creates archetypes and the initial
 *   entities, deterministically (it runs before tick 0)
 * @property {(sim: import('./sim-core.js').SimCore, hud: import('../ui/state-block.js').StateBlockWriter, frame: FrameStats) => void} extract
 *   writes the UI state block (called between `begin()` and `end()`)
 */

export {};
