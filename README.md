# Prophet

**Prophet** is a from-scratch, GPU-first 3D game engine in **pure, class-based JavaScript**. It runs on **WebGPU compute**, uses **Web Workers** for multithreading, and draws its UI with **real HTML/CSS**. One web build ships to desktop browsers and, through Electron, to Steam on Windows, macOS, Linux and Steam Deck.

**SCRAPWAKE** is its first game: a roguelite that crosses Vampire Survivors with tower defence, set in a fully destructible voxel cyberpunk city. You play a broken robot that rebuilds itself from the scrap it finds.

> **Status: M1–M2 foundation in place.** The engine is built increment by increment on top of the M0 concept docs, which remain the contract ([ROADMAP](docs/ROADMAP.md)). The tech demo plays in the browser and in Electron, from source or from the production bundle:
> - PATCH against a GPU swarm, bit-exact with its JS reference.
> - Pixel-exact oblique rendering.
> - Replays that reproduce a GPU run in Node.
> - Device-loss recovery.

---

## The game in one screen

> *"Rebuild yourself from scrap. Tear down the city. Hold the Forge."*

In the megacity **Meridian**, the corporation **HALCYON** runs "Clean Sweep" drone swarms that erase every unlicensed machine. **PATCH**, a scrapped maintenance robot, reboots as a legless husk beside a derelict fabricator: **the Forge**. Each run (a "Cycle") takes place in a procedural district of about 20 minutes:
- Roam the city and fight endless swarms, Vampire Survivors-style.
- **Tear buildings down** for scrap, and collapse them onto the swarm.
- **Rebuild your body** part by part. Every arm, leg, back and head module is a weapon or ability you can see.
- Race back to **hold the Forge** with towers and walls when the Sweep assault hits.

**Pillars:**
1. **You are your build.** PATCH's body is the loadout. Four weapon hardpoints plus core, legs and chips, all visible.
2. **Everything breaks.** The voxel city is a weapon, a resource and a tactic.
3. **Hold the Forge.** A base to fortify, with towers and walls that reshape the swarm's paths.
4. **Readable chaos.** Orange is you, cyan is them. Pixel-exact 3D pixel art keeps thousands of enemies legible.
5. **One more cycle.** Short runs, deep synergies, meta progression.

**Why it can stand out.** No hit game yet combines survivors-style combat, in-run base building and tower defence, and destructible voxel terrain. A robot whose body *is* the build, visibly falling apart and reassembling, is unclaimed territory ([competitive landscape](docs/game/01-gdd.md#competitive-landscape)).

## The engine in one screen

| | |
|---|---|
| **Language** | Pure ES2023+ JavaScript classes. Zero runtime dependencies; JSDoc + `tsc --checkJs` for types. |
| **GPU** | WebGPU only, core feature level. Heavy compute: GPU swarm simulation, culling, particles, light binning. |
| **Threads** | Engine worker (simulation + GPU) + job workers over a fixed shared heap, with fallbacks when shared memory is unavailable. |
| **ECS** | Archetype SoA ECS. Systems are classes; the scheduler parallelizes wherever profiling says it pays off. |
| **Simulation** | Two tiers: CPU actors plus a GPU-resident swarm of tens of thousands of units. Integer-only and deterministic (replays; co-op-ready). |
| **World** | 0.25 m voxels, structural-graph collapse, flow-field navigation, seeded procedural districts. |
| **Look** | Pixel-exact 3D pixel art: integer-scaled low-res render, outlines, toon ramps, palette LUT, neon bloom. |
| **UI** | Real DOM with custom elements and modern CSS (flexbox, grid, container queries, `:has()`), fed by a seqlocked state bridge. |
| **Platforms** | Web (desktop browsers, PWA) and Electron (Windows, macOS, Linux, Steam Deck). Mobile is deferred until after 1.0 ([ADR-024](docs/DECISIONS.md#adr-024-desktop-and-web-only)). |

## Read the docs

**Suggested reading order:**
1. [Game Design Document](docs/game/01-gdd.md)
2. [Engine overview](docs/engine/01-overview.md)
3. [Budgets](docs/BUDGETS.md)
4. [Roadmap](docs/ROADMAP.md)

| Doc | What's inside |
|---|---|
| [DECISIONS](docs/DECISIONS.md) | Every architecture and design decision (ADRs), with the rationale and when to revisit it |
| [BUDGETS](docs/BUDGETS.md) | **Single source of truth for every number:** tiers, reference devices, frame and memory budgets, caps, constants, quality gates |
| [GLOSSARY](docs/GLOSSARY.md) | Engine and game terminology |
| [ROADMAP](docs/ROADMAP.md) | Risk-first milestones with exit metrics, risk register, cut list |
| [VERTICAL-SLICE](docs/VERTICAL-SLICE.md) | Slice content scope and the Minimum Viable Engine |
| **Engine** | |
| [01 Overview](docs/engine/01-overview.md) | Goals, principles, runtime topology, frame pipeline, repo layout, JS conventions |
| [02 Core: ECS & jobs](docs/engine/02-core-ecs-jobs.md) | Shared heap and arenas, ECS, scheduler, job system, threading tiers |
| [03 Rendering](docs/engine/03-rendering.md) | WebGPU device, render graph, GPU-driven rendering, lighting, readback ring, device loss |
| [04 Pixel-art pipeline](docs/engine/04-pixel-art-pipeline.md) | Projection, resolution and scaling, snapping, outlines, grading, occlusion |
| [05 GPU swarm](docs/engine/05-gpu-swarm.md) | The GPU-resident swarm and the CPU-GPU contract |
| [06 World](docs/engine/06-world.md) | Voxels, destruction, collision, navigation, procedural generation |
| [07 UI](docs/engine/07-ui.md) | DOM architecture, state bridge, CSS system, input, accessibility |
| [08 Platforms](docs/engine/08-platforms.md) | Web, Electron, Steam, saves, tier detection |
| [09 Determinism & co-op](docs/engine/09-determinism-coop.md) | Integer simulation, RNG, replays, co-op model |
| [10 Tooling & testing](docs/engine/10-tooling-testing.md) | Dev server, build, asset pipeline, dev tools, tests, CI |
| **Game** | |
| [01 GDD](docs/game/01-gdd.md) | Loop, body-as-loadout, economy, base and towers, destruction, enemies, pacing, balance, meta, KPIs, market |
| [02 Content](docs/game/02-content.md) | Parts, chips, fusions, towers, enemies, bosses, districts, events |
| [03 Art & audio](docs/game/03-art-audio.md) | Palette, scale, lighting, characters, VFX, UI look, HUD wireframes, audio |
| [04 UX flows](docs/game/04-ux-flows.md) | Screens and flows for keyboard/mouse and gamepad |

## Minimum spec (summary)

Any desktop browser with WebGPU:
- Chrome/Edge 113+
- Safari 26+ on macOS
- Firefox 141+ on Windows, 145+ on Apple Silicon

Plus the desktop app (Electron 44) on Windows, macOS, Linux and Steam Deck. Phones and tablets are not supported before 1.0. Details: [ADR-020](docs/DECISIONS.md#adr-020-minimum-spec).

## Roadmap (summary)

1. **M1:** platform spike.
2. **M2:** GPU swarm spike, with a throwaway 2D loop prototype in parallel (M2′).
3. **M3:** world spike.
4. **M4:** look-dev.
5. **M5:** Minimum Viable Engine.
6. **M6:** vertical slice.
7. **M7:** Steam Early Access + web demo.
8. **M8:** 1.0 + web portals.

Details and exit metrics: [ROADMAP](docs/ROADMAP.md).

## Quick start

Needs Node 22 and a browser with WebGPU.

```sh
npm ci
npm run dev             # http://localhost:4173 (COOP/COEP headers, live reload)
npm run check           # typecheck + sim lint + unit tests
npm run test:browser    # Playwright + headless Chromium with WebGPU
npm run electron:dev    # the desktop shell, serving the repo
npm run build           # production bundle in dist/web (hashed, WGSL inlined, _headers)
npm run electron        # build, then the desktop shell on dist/web
npm run replay -- f.json  # replay an exported run in Node on the JS reference swarm
```

**The tech demo** (`npm run dev`, then open the page):
- Move PATCH with WASD, the arrow keys or a gamepad's d-pad and left stick. PATCH fires on its own.
- Swarm rings spawn around PATCH and chase it.
- `=` and `-` raise and lower the director's stress; `]` spawns a burst ring.
- URL options:
  - `?units=&shots=` override the swarm pools.
  - `?swarm=cpu` runs the JS reference swarm.
  - `?threading=`, `?driver=`, `?perf=` force a tier.
- `window.__px.exportReplay()` returns the run so far; `npm run replay` checks that it replays identically.

Working rules for contributors (and coding agents) are in [CLAUDE.md](CLAUDE.md).

## Repository layout

```
engine/     Prophet: pure JS, zero runtime dependencies
game/       SCRAPWAKE: entry points, components, systems, shaders, UI, data
platforms/  electron/
tools/      dev server, sim lint, production build, replay, generators (asset cooker to come)
tests/      unit (node:test) · browser (Playwright + WebGPU) · electron
docs/       the concept and the specs
```

## License

All rights reserved (proprietary). See [LICENSE](LICENSE).
