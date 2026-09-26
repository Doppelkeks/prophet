# Glossary

These terms are used across the Prophet engine docs and the SCRAPWAKE game docs. Engine terms are tagged *(engine)*, game terms *(game)*. Numbers live in [BUDGETS.md](BUDGETS.md).

| Term | Meaning |
|---|---|
| **Actor** *(engine)* | A gameplay entity simulated on the CPU by the ECS: PATCH, towers, specialists, bosses, caches, the Forge. Opposite of a **swarm unit**. See [two-tier simulation](engine/05-gpu-swarm.md). |
| **Actor proxy** *(engine)* | Compact per-tick copy of an actor's position, radius, team and flags, uploaded so the GPU swarm can collide with, target and avoid actors. |
| **ADR** | Architecture Decision Record. Collected in [DECISIONS.md](DECISIONS.md). |
| **Archetype** *(engine)* | The set of component types an entity has. Entities with the same archetype are stored together in SoA **ECS chunks**. |
| **Arena** *(engine)* | A fixed region of the **heap** reserved for one subsystem (ECS, voxels, nav…). Arenas never grow. |
| **Area effect** *(engine)* | CPU→GPU command: "apply damage, status or impulse to swarm units inside this shape at tick T". Explosions, shockwaves and EMP pulses are all area effects. |
| **Assault** *(game)* | A **Sweep** wave that converges on the **Forge** every few minutes. It is the tower-defence beat of the loop. |
| **Banked level-up** *(game)* | Level-ups queue up instead of interrupting play. The player opens them when it suits them, or at auto-prompts during lulls. |
| **Base field** *(engine)* | Flow field whose goal is the Forge. Assault units follow it. |
| **Blueprint ghost** *(game)* | A planned structure placed on the build grid. Forge drones construct it in real time. |
| **Breacher** *(game)* | Specialist that tunnels through voxels and walls toward the Forge. Every assault includes one "Prime" Breacher that only PATCH can damage. |
| **Brickmap** *(engine)* | Two-level sparse voxel structure used by the alternative compute-raymarch renderer (a look-dev spike). |
| **Chassis** *(game)* | A starting kit for PATCH (Mender, Bulwark, Skitter, Wrecker), unlocked in the Workshop. |
| **Chip** *(game)* | Passive modifier. PATCH has 6 chip slots. |
| **Chunk, ECS** *(engine)* | Fixed-capacity SoA block of entities that share an archetype. It is the unit of parallel iteration. |
| **Chunk, voxel** *(engine)* | A 32³ block of voxels. The unit of storage, meshing and upload. Always say which kind of chunk you mean. |
| **Command buffer** *(engine)* | Per-thread binary log of deferred ECS changes (spawn, despawn, add or remove component, set a value). It is applied at sync points in a deterministic order. |
| **Core** *(game)* | PATCH's energy slot. It powers weapons and the Overclock active ability. |
| **Cycle** *(game)* | One run: a single procedural district, ~20 minutes. It ends when PATCH **clocks out** after the district boss (optional overtime can continue), or in defeat. |
| **Clock out** *(game)* | Ending a Cycle voluntarily after the district boss, banking its rewards. Not to be confused with the engine's **Extract** frame phase. |
| **Design load** | The entity count the game design uses, as opposed to the technical **ceiling**. See [BUDGETS.md](BUDGETS.md#entity-caps). |
| **Device loss** *(engine)* | The WebGPU device disappears (backgrounding, driver reset). The engine rebuilds GPU state from the CPU copy. |
| **Director** *(game/engine)* | System that paces spawns: minute tables plus adaptive intensity. |
| **District** *(game)* | The procedural map of one Cycle. Examples: Rust Docks, Neon Bazaar, Glasswall, The Sump, Halcyon Spire. |
| **Engine worker** *(engine)* | The dedicated worker that owns the sim loop and the WebGPU device. |
| **Epoch (layout)** *(engine)* | Counter bumped whenever archetype or column tables change. Workers re-read the layout when the epoch changes. |
| **Event (GPU→CPU)** *(engine)* | Tick-stamped record the GPU swarm produces (voxel hit, specialist hit, stats) and the CPU applies at tick *T+K*. |
| **Extract** *(engine)* | Frame phase that copies render-relevant state into GPU upload buffers. |
| **Fire command** *(engine)* | CPU→GPU: "weapon or tower X fires pattern P with target policy Q at tick T". The GPU chooses the target. |
| **Fodder** *(game)* | Simple enemies that live entirely in the GPU swarm (Mites, Scrubbers, Hover Wasps…). Not saved in checkpoints. |
| **Forge** *(game)* | PATCH's base: a derelict fabricator. It is the base core, power source, shop and respawn point. If it is destroyed, the run is lost. |
| **FrameDriver** *(engine)* | Abstraction that ticks the engine worker. It uses worker `requestAnimationFrame` where available, otherwise main-thread rAF pings (needed for Safari). |
| **Fusion** *(game)* | A max-level part plus a matching chip turns into an evolved part when the player opens an elite cache. |
| **Halcyon** *(game)* | The corporation that runs Meridian. Also a part rarity: stolen corporate tech, blue-tinted. |
| **Hardpoint** *(game)* | A body slot that carries a weapon: HEAD, ARM L, ARM R, BACK. |
| **Heap** *(engine)* | The single fixed-size shared `WebAssembly.Memory` that holds all hot engine data. |
| **Husk** *(game)* | PATCH without legs, at run start or after a Shatter. It crawls. |
| **K / K-latency** *(engine)* | Fixed delay in ticks between a GPU event being produced and the CPU applying it. See [BUDGETS.md](BUDGETS.md#simulation-constants). |
| **Lockstep** *(engine)* | Co-op model where every peer runs the same deterministic sim from the same inputs. |
| **Manifest (components)** *(engine)* | Generated file that assigns stable numeric IDs to component types, identical on every worker. |
| **Meridian** *(game)* | The megacity setting. |
| **MVE** | Minimum Viable Engine: the smallest engine feature set that can ship the vertical slice. See [VERTICAL-SLICE.md](VERTICAL-SLICE.md). |
| **Overclock** *(game)* | The Core's active ability: a short burst of boosted fire rate and speed. |
| **PATCH** *(game)* | The protagonist, a scrapped maintenance robot rebuilding itself. |
| **Performance tier** | `high`, `std` or `mobile`. See [BUDGETS.md](BUDGETS.md#quality-tiers). |
| **Pickup** *(game/engine)* | A scrap gem. It lives in the GPU swarm, is magnetised to PATCH, and merges when over the cap. |
| **Plating** *(game)* | PATCH's armour upgrade track, shown as visible armour pieces. |
| **Player field** *(engine)* | Full-map flow field whose goal is PATCH. Chasers follow it. |
| **Power** *(game)* | A single global capacity number from the Forge and Generators. Towers consume it. |
| **Prefab kit** *(game/engine)* | MagicaVoxel-authored modular pieces (walls, floors, roofs, signs) that the procedural generator assembles into buildings. |
| **Readback ring** *(engine)* | A ring of at least K + 1 GPU→CPU staging buffers, read via `mapAsync` without stalling and harvested strictly in submission order. |
| **Recall** *(game)* | A 2 s channel that teleports PATCH to the Forge. It has a cooldown. |
| **Render graph** *(engine)* | A per-frame declaration of GPU passes and resources, compiled into one command submission. |
| **Scrap** *(game)* | The run currency. Collected scrap counts toward XP (the total collected) and is spent as currency (the current balance). |
| **Seqlock** *(engine)* | Sequence-counter protocol that lets the main thread read the UI state block without tearing. |
| **Shatter** *(game)* | At 0 HP, PATCH breaks apart and must re-collect its scattered parts within a short window. It costs a reboot charge and doubles as the co-op revive. |
| **Sim profile** *(engine)* | The tier-dependent constants that change simulation results (K, commit lags, swarm rate, caps, district size). It is fixed per run; co-op uses the lowest common profile. See [BUDGETS.md](BUDGETS.md#sim-profiles). |
| **Sim tick** *(engine)* | One fixed simulation step. See [BUDGETS.md](BUDGETS.md#simulation-constants). |
| **SoA** | Structure of Arrays: one array per field. The hot data layout for ECS columns and GPU buffers. |
| **Sparks** *(game)* | Meta currency, spent in the Workshop between runs. |
| **Specialist** *(game)* | A non-fodder enemy simulated as a CPU actor (Enforcer, Sniper, Carrier…). |
| **State block** *(engine)* | Fixed-layout shared-memory struct the engine writes and the DOM UI reads (HP, scrap, timers…). |
| **Structural graph** *(engine)* | Per-building graph of load-bearing elements (pillars, slabs, walls). Collapse is evaluated on the graph, not by flood-filling voxels. |
| **Sweep, the** *(game)* | Halcyon's automated "Clean Sweep" forces: every enemy in the game. |
| **Swarm unit** *(engine)* | An entity that lives in the GPU swarm: fodder, projectiles, pickups, particles, debris. |
| **Threading tier** *(engine)* | `shared` (SharedArrayBuffer job system), `transfer` (transferable buffers, coarse jobs only) or `inline` (single thread, tests only). |
| **TWA** | Trusted Web Activity: an Android app that runs our web build in Chrome. |
| **Vertical slice** | The first shippable-quality slice of the game. See [VERTICAL-SLICE.md](VERTICAL-SLICE.md). |
| **Workshop** *(game)* | The meta hub between runs, where Sparks buy permanent unlocks. |
