# Prophet / SCRAPWAKE: working notes

Prophet is a from-scratch engine in **pure, class-based JavaScript** (ES2023 modules, JSDoc types, no TS syntax) on **WebGPU** and **Web Workers + SharedArrayBuffer**. SCRAPWAKE is its first game. The targets are desktop browsers and Electron only; there is no mobile. Runtime npm dependencies: zero.

The docs are the spec:
- `docs/BUDGETS.md`: every number
- `docs/DECISIONS.md`: the ADRs
- `docs/engine/*.md`: subsystem designs
- `docs/game/*.md`: the game

Keep code and docs in sync.

## Commands

| Command | Does |
|---|---|
| `npm run dev` | Dev server on http://localhost:4173 (COOP/COEP/CORP, live reload) |
| `npm run check` | Typecheck (`tsc` checkJs) + sim lint + unit tests (`node --test`) |
| `npm run test:browser` | Playwright + headless Chromium with WebGPU (SwiftShader) |
| `npm run test:electron` | Electron smoke; on Linux without a display, prefix `xvfb-run -a` |
| `npm run build` | Production bundle in `dist/web` |
| `npm run electron:dev` | Electron serving the repo root |

## Rules

- **Simulation code is integer-only**: `engine/**/sim/`, `engine/swarm/reference/`, `game/systems/sim/`, and the WGSL kernels in `engine/swarm/kernels/`.
  - Use the `Fixed` and `Rng` helpers from `engine/core`.
  - No `Math.*` transcendentals, no floats, no `Date.now` or `performance.now`, no bare `/` (use `Fixed.idiv`).
  - `npm run lint:sim` enforces this. An exception needs `// sim-allow: <reason>` on the line.
- `engine/` never imports `game/`. Entry points live only in `game/app/`.
- Only `engine/jobs/job-worker-loop.js` may call `Atomics.wait`. The engine worker never blocks.
- Hot paths: no allocation, no closures, index typed-array views by offset.
- Manifest order comes from explicit `static key` strings, never `Class.name`.
- WebGPU needs a secure context. Tests load `http://localhost` with COOP/COEP (the dev server does this).
- The GPU swarm must stay bit-exact with `engine/swarm/reference/`, and the browser tests compare them every tick.
