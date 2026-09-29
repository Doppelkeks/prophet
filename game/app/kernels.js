// @ts-check
// The kernel list of SCRAPWAKE. The engine worker and every job worker build their KernelRegistry from
// this same list; a job worker whose list hashes differently refuses to start (manifest-mismatch).
// ECS chunk kernels and async kernels (PCG, flow fields, meshing) are added here as they land.

/** @type {(typeof import('../../engine/jobs/kernel.js').Kernel)[]} */
export const GAME_KERNELS = [];
