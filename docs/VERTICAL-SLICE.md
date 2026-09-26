# Vertical Slice

The vertical slice is the first build of SCRAPWAKE at **shippable quality**. It proves the game loop and the engine together, on every platform family, and it is the basis for:
- the private web demo
- external playtests
- the Steam page trailer
- the Early Access scope

It is milestone **M6** in the [ROADMAP](ROADMAP.md#milestones). The engine underneath it is the **Minimum Viable Engine** (MVE), delivered in M5.

Content *counts* per release live in the [GDD: Slice vs 1.0](game/01-gdd.md#slice-vs-10). This doc names the specific items, the quality bar and the engine scope. Numbers live in [BUDGETS.md](BUDGETS.md).

---

## Content scope

| Area | In the slice | Source |
|---|---|---|
| District | **Rust Docks**: a container port with gantry cranes, container stacks, warehouses, fuel depots and piers; procedural every run | [Districts](game/02-content.md#districts) |
| Mode | **Standard** Cycle: 20 min plus overtime. The web demo caps it at 10:00, ending on the Demolisher. | [GDD: modes](game/01-gdd.md#modes) |
| Chassis | **Mender**: Rivet Driver on ARM R, Cracked Core, no legs at start | [GDD: body as loadout](game/01-gdd.md#body-as-loadout) |
| Arms | Rivet Driver, Arc Welder, Scatter Cannon, Plasma Cutter | [Parts](game/02-content.md#parts) |
| Heads | Scanner Optic, Tactical Array | [Parts](game/02-content.md#parts) |
| Backs | Drone Bay, Scrap Magnet, Missile Rack | [Parts](game/02-content.md#parts) |
| Legs | Scrap Stilts, Sprinter Legs, Stomper Legs | [Parts](game/02-content.md#parts) |
| Cores | Cracked Core, Overclock Core | [Parts](game/02-content.md#parts) |
| Rarities | All 5. The Anomalous quirks in the slice are Unstable, Echo and Phase. | [Parts](game/02-content.md#parts) |
| Caches | Legs, Part, Chip, Scrap, Military, Elite and Corrupted | [Parts](game/02-content.md#parts) |
| Chips | Capacitor, Ballistics Co-processor, Thermal Regulator, Servo Booster, Magnet Coil, Foreman Protocol | [Chips](game/02-content.md#chips) |
| Fusions | Stormbreaker Fist, Rivet Storm, Sunderbeam | [Fusions](game/02-content.md#fusions) |
| Structures | Rivet Turret, Flame Vent, Arc Pylon, EMP Spire, Mortar (damages terrain), Scrap Wall; Mk I–III with Mk III branches | [Towers](game/02-content.md#towers) |
| Forge upgrades | Reinforce, Capacitor Bank, Power Cell, Shield Emitter, Drone Dock, Munitions, Perimeter | [Towers](game/02-content.md#towers) |
| Fodder (GPU swarm) | Mite, Scrubber, Hover Wasp, Crawler Mine | [Enemies](game/02-content.md#enemies) |
| Specialists (CPU actors) | Enforcer, Breacher, **Breacher Prime**, Sniper, Carrier | [Enemies](game/02-content.md#enemies) |
| Elite modifiers | Armoured, Volatile, Swift | [Enemies](game/02-content.md#enemies) |
| Bosses | Demolisher (mid-boss, 10:00), Warden Titan (district boss, 20:00) | [Bosses](game/02-content.md#bosses) |
| Events | Data Terminal, Supply Drop, Corrupted Cache | [Events](game/02-content.md#events) |
| Meta | Workshop v1 (Sparks, pool unlocks, Forge starting upgrades) and 8 memory fragments. No heat tiers, no daily seed. | [GDD: meta progression](game/01-gdd.md#meta-progression) |
| Signature mechanics | Banked level-ups; blueprint ghosts built by Forge drones; Recall; Forge shield; Breacher Prime; **Shatter**; scrap as both XP and currency; demolition returns; structural collapse | [GDD](game/01-gdd.md#core-loop) |
| UI screens | Title, Workshop, Chassis select (Mender only), HUD, Level-up, Build mode, Assembly screen, Pause & settings, Results | [UX flows](game/04-ux-flows.md#screen-map) |
| Audio | One adaptive district track with 4 stems (the cut list allows 2), the siren and broadcast set, and the full SFX set for the slice content | [Audio direction](game/03-art-audio.md#audio-direction) |
| Accessibility | Remapping, UI scale, reduced motion, flash limiter, shape-first danger coding, auto-aim, captions for key cues, game speed (Assisted) | [GDD: accessibility](game/01-gdd.md#accessibility) |
| Localization | English plus the pseudo-locale; every string in tables | [07: localization](engine/07-ui.md#localization) |

### Platforms in the slice

| Platform | Slice status |
|---|---|
| Web: Chrome/Edge, Safari 26+, Firefox (Windows) | Full target, meeting the quality gates |
| Electron: Windows, macOS, Linux, **Steam Deck** | Full target, meeting the quality gates |
| iOS host (localhost server), Android TWA | **Technical proof**: a full run is playable, with checkpoint and resume; performance within the `mobile` budgets on the reference phones |
| Portals, Steam integration, store packaging | Not in the slice (M7/M8) |

---

## Minimum viable engine

The MVE is the smallest engine that can ship this slice. Everything in the **Deferred** column waits until the game needs it.

| Subsystem | In the MVE | Deferred |
|---|---|---|
| Core ([01](engine/01-overview.md), [02](engine/02-core-ecs-jobs.md)) | Fixed heap and arenas; component manifest; fixed-point math, the trig table and `isqrt`; hash RNG; FrameDriver (both modes); tier detection; sim profiles | WASM SIMD kernels |
| ECS & jobs ([02](engine/02-core-ecs-jobs.md)) | Archetype ECS; scheduler (serial + chunk-parallel); job system in the `shared` and `transfer` tiers (plus `inline` for tests); command buffers and events | Automatic parallelization suggestions beyond dev-build profiling |
| Rendering ([03](engine/03-rendering.md)) | Device and features, render graph, async pipeline warm-up, GPU-driven instancing, voxel chunk rendering, tiled lights, shadow map, GPU particles and debris, world-space UI, readback ring, device-loss recovery | Photo mode |
| Pixel-art pipeline ([04](engine/04-pixel-art-pipeline.md)) | The projection chosen in M4, snapping, outlines, toon shading, LUT, bloom, fog, occlusion handling, three zoom levels | The unchosen projection candidate; the brickmap raymarcher, unless M4 picks it |
| GPU swarm ([05](engine/05-gpu-swarm.md)) | The full pass chain; fire commands with target policies; area effects; the status vocabulary; counters, events and maps; the JS reference implementation | — |
| World ([06](engine/06-world.md)) | Voxel storage, edits and damage; structural graphs, collapse and kinematic debris; character controller; raycasts; base and player flow fields; procedural generation for Rust Docks | The other district themes |
| Determinism ([09](engine/09-determinism-coop.md)) | Integer sim rules plus the lint; input as commands; async commits at fixed ticks; replays and state hashes (L1 in CI, L2 on the lab) | Networking and co-op sessions |
| UI ([07](engine/07-ui.md)) | `UiElement`, signals, router, seqlocked state bridge, combat HUD rules, the screens above, keyboard/mouse + gamepad + touch input, glyph switching, accessibility baseline | CJK fonts; View Transitions polish |
| Audio | Buses, pooled SFX with per-type caps, music stems, the audio event ring | AudioWorklet mixer |
| Platforms ([08](engine/08-platforms.md)) | Web build with headers and a basic PWA; Electron builds (Windows, macOS, Linux, Deck switches); saves (settings, meta, checkpoints); lifecycle; iOS/Android technical shells | Steam shim (M7); store packaging (M8); portal adapters (M8) |
| Tooling ([10](engine/10-tooling-testing.md)) | Dev server with hot reload; esbuild build; asset cooker (`.vox`, LUT, data validation, manifests); dev tools (perf overlay, ECS inspector, swarm/world/director tools, replay controls); every test layer; CI workflows `check`, `browser`, `build`, `preview` | Self-hosted GPU runner (optional) |

---

## Quality bar

- **Gates:** every [quality gate](BUDGETS.md#quality-gates) that applies to M6, on every [reference device](BUDGETS.md#reference-devices).
- **Game KPIs:** the M6 playtest (≥ 30 external players) meets the [KPIs](game/01-gdd.md#kpis). That covers Forge-time share, one-more-run rate, FTUE completion, building and destruction engagement.
- **Feel checklist:**
  - Dash and aim-override respond within the [latency target](BUDGETS.md#latency-targets).
  - Hits flash instantly; big impacts get hitstop.
  - The swarm never traps PATCH.
  - 3–5k on-screen swarm units stay readable (orange vs cyan, shape-coded projectiles).
  - A collapse is visible and fair: creaks, a telegraph, then crush damage.
  - Placing a tower takes under 2 s on every input device.
  - Recall + the Forge shield let a far-roaming player make it back in time.
- **Stability:** no progression-blocking bugs; checkpoint and resume work on every slice platform; device-loss recovery demonstrated in the build.

## Out of scope for the slice

- Districts beyond Rust Docks; Chassis beyond Mender.
- Blitz, Endless and Daily Seed modes; heat tiers.
- Shepherds, Leeches and Jammers; the Hive Queen and Sweep Nexus; the Rogue Mender and Blackout events.
- Co-op (local or online).
- Steam integration, store packaging and portal builds.
- Localization beyond English.

## Exit

See [ROADMAP: M6](ROADMAP.md#m6-vertical-slice).
