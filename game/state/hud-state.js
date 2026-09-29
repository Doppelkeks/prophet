// @ts-check
// The UI state block of SCRAPWAKE: one schema shared by the engine (writer) and the UI (reader), so field
// offsets can't drift apart (docs/engine/07-ui.md#state-bridge).
import { StateSchema } from '../../engine/ui/state-block.js';

export const HUD = new StateSchema({
  tick: 'u32',
  patchX: 'i32', // Q10 m
  patchY: 'i32', // Q10 m
  hp: 'i32', // Q8
  scrap: 'u32',
  hpMax: 'i32', // Q8
  kills: 'u32',
  alive: 'u32', // swarm units alive (reported at T − K)
  shots: 'u32',
  waves: 'u32',
  downs: 'u32',
  rejected: 'u32',
  stalls: 'u32',
  stress: 'u32',
  fps: 'f32',
  frameMs: 'f32',
  simMs: 'f32',
  ticks: 'u32', // sim ticks run in the last frame
  skipped: 'u32', // frames skipped because the previous one was still running
  entities: 'u32',
  readbackP95: 'f32', // ms, submit → harvested (GPU swarm only)
});
