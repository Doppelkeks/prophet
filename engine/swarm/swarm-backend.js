// @ts-check
// What SimCore needs from a swarm implementation. Two exist: the GPU `Swarm` (WGSL kernels, readback
// ring) and `SwarmReference` (pure JS). Blocks come back strictly in submission order.

/**
 * @typedef {object} SwarmBackend
 * @property {import('./swarm-layout.js').SwarmLayout} layout
 * @property {(tick: number, inbound: Int32Array, prevFires: number, field?: Int32Array | null) => void} submit runs tick
 *   `tick`; `field` is the flow field committed on it, if any (copied into the back field buffer)
 * @property {(tick: number) => Int32Array | null} take the outbound block of `tick` once it has arrived (then forgets it)
 */

export {};
