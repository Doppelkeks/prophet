# SCRAPWAKE: Content Catalog

This catalog lists the planned parts, chips, fusions, towers, enemies, bosses, districts and events, with starting numbers and a **Slice / 1.0** marker. The rules that use these numbers are in the [GDD](01-gdd.md): scaling formulas are in [Balance math](01-gdd.md#balance-math), and slice scope is in [Slice vs 1.0](01-gdd.md#slice-vs-10) and [content scope](../VERTICAL-SLICE.md#content-scope). Art direction for each item is in [03-art-audio](03-art-audio.md#characters).

**Every number here is a tuning starting point.** The M2′ prototype and the vertical slice validate them.

How to read the tables:
- **Parts** show level 1, Scrap rarity, no chips. DPS is single-target. Level and rarity multipliers are in [Body as loadout](01-gdd.md#body-as-loadout).
- **Enemies** show values at 0:00 at `high`-tier density:
  - Fodder HP × (1 + t/10)².
  - Specialist HP = time-to-kill (TTK) × *DPS_exp*(t).
  - All enemy damage × (1 + t/10).
  - On other tiers, counts, HP and scrap follow the [tier density](01-gdd.md#tier-density) rule.
- **Structures:** prices × g² and HP × g (the Grade). Mk II costs 1.5 × base, Mk III 3 × base.
- **Tags:** Kinetic, Arc, Thermal, Explosive, Drone, Engineer, Demolition, Utility, Defence, Mobility. Chips and fusions key off tags and specific parts.
- **Targeting modes:** Nearest, Strongest, First (closest to the Forge along the base field), Chain, Cursor (manual aim).
- **Statuses** (Burning, Shocked, Slowed, Stunned, Marked, Corroded, Magnetized, Overheated; short forms Burn, Shock, Slow, Stun) are defined in the GDD's [Enemies](01-gdd.md#enemies) section.

---

## Parts

Each part gains the first listed perk at level 3 and the second at level 5, and level 5 makes it fusion-eligible. For parts that deal little or no damage, the level multiplier scales their main value instead (shield capacity, repair rate, aura strength).

### Arms (ARM L or ARM R)

| Part | Tags | Targeting | Damage × rate | Range | DPS | Behaviour | Lv3 · Lv5 perk | Visual | Slice / 1.0 |
|---|---|---|---|---|---|---|---|---|---|
| Rivet Driver | Kinetic | Nearest | 10 × 2.0/s | 14 m | 20 | Straight rivets | +1 pierce · every 5th rivet ricochets twice | Pneumatic riveter with a rivet belt | Slice (starter) |
| Arc Welder | Arc | Chain | 12 × 1.4/s | 8 m | 17 | Jumps to 2 more targets (−30 % per jump); Shock | +1 jump · jumps fork | Welding torch throwing amber arcs | Slice |
| Scatter Cannon | Kinetic | Nearest | 6 pellets × 5 × 0.9/s | 7 m, 40° cone | 27 | Knockback | +2 pellets · pellets damage walls | Flared scrap-pipe barrel | Slice |
| Plasma Cutter | Thermal, Demolition | Nearest | Beam 24/s | 6 m | 24 | Cuts voxels; Burn | Wider beam · cuts reinforced materials and Corrodes | Nozzle with a molten orange blade | Slice |
| Grapple Claw | Kinetic, Demolition | Strongest | 40 (AoE 1.5 m) × 0.6/s | 10 m | 24 | Rips a chunk from the nearest structure and hurls it; with no structure near, grabs and throws an enemy | Bigger chunks · two throws | Three-fingered crane claw on a cable | 1.0 |
| Mortar Arm | Explosive, Demolition | Strongest | 45 (AoE 2.5 m) × 0.5/s | 6–18 m | 22 | Lobbed shell with a minimum range; craters voxels | +0.5 m radius · bomblets | Shoulder-braced launch tube | 1.0 |
| Drill Fist | Kinetic, Demolition | Nearest | 14 × 4.0/s | 2 m cone | 56 | Melee; the dash drills through walls | Dash drill ×2 damage · drill shockwave (3 m) | Oversized spiral drill | 1.0 |
| Nail Swarm | Kinetic, Drone | Nearest | 8 nails × 6 × 0.5/s | 12 m | 24 | Homing nail cloud | +4 nails · nails embed and explode | Canister with a whirring magnetic coil | 1.0 |

### Heads

| Part | Tags | Targeting | Damage × rate | Range | DPS | Behaviour | Lv3 · Lv5 perk | Visual | Slice / 1.0 |
|---|---|---|---|---|---|---|---|---|---|
| Scanner Optic | Utility | Strongest | 5 every 3 s | 16 m | 2 | Marks the target (Marked, 4 s); +25 % pickup radius; shows caches in the mid ring on the minimap | Marks 2 targets · Marked kills drop +50 % scrap | Single oversized lens | Slice |
| Tactical Array | Engineer | Nearest | Beam 8/s | 8 m | 8 | Towers within 10 m of PATCH gain +20 % fire rate | Aura 14 m · towers in the aura gain +1 target | Antenna crown | Slice |
| Siege Visor | Kinetic | Strongest | 60 × 0.33/s | 22 m | 20 | Pierces everything in line. After 1 s standing still, all weapons gain +15 % range and +10 % crit. | Charge time 2.5 s · shots break damaged voxels | Slit visor with a rangefinder | 1.0 |
| Optic Laser | Thermal | First | Beam 18/s | 12 m | 18 | Sweeping eye beam; 20 % Burn chance | +25 % length · splits into two beams | Glowing eye lens | 1.0 |

### Backs

| Part | Tags | Targeting | Damage × rate | Range | DPS | Behaviour | Lv3 · Lv5 perk | Visual | Slice / 1.0 |
|---|---|---|---|---|---|---|---|---|---|
| Drone Bay | Drone | Nearest | 2 drones × 8 × 1.5/s | 10 m around PATCH | 24 | Orbiting gun drones | +1 drone · drones repair towers while PATCH is in the Yard | Hatch box with rotor drones | Slice |
| Scrap Magnet | Utility, Kinetic | Nearest | 15 × 0.33/s | 12 m | 5 | +100 % pickup radius; fires magnetised shards (pierce 2) | Pulls demolition chunks from twice as far · 3 shards per volley | Horseshoe magnet coil | Slice |
| Missile Rack | Explosive | Strongest | 4 × 14 (AoE 1.5 m) × 0.33/s | 18 m | 19 | Homing salvo | +2 missiles · cluster warheads | Pod rack | Slice |
| Jet Pack | Mobility, Thermal | — | Trail 15/s | — | — | The dash becomes a 6 m jet burst over walls and rubble, leaving a 2 s burning trail | +1 dash charge · landing blast (40) | Twin thrusters | 1.0 |
| Shield Projector | Defence | — | Pulse 20 (AoE 3 m) | — | — | 40-point shield that regenerates 15/s after 4 s without hits; knockback pulse when it breaks | Regenerates after 2.5 s · the pulse Stuns 1 s | Dish emitter | 1.0 |
| Turret Pack | Engineer | Nearest | Mini-turret 12/s | 10 m | 12 per turret | Drops a mini-turret (no Power) every 12 s; each lasts 15 s; max 2 | Max 3 · turrets inside the Yard persist | Folded turret on a frame | 1.0 |
| Repair Arm | Engineer, Defence | Nearest | Zap 6/s | 4 m | 6 | Heals PATCH 2 HP/s; repairs the nearest structure within 6 m at 15 HP/s × g | +50 % repair · repairs every structure within 6 m at once | Articulated welder arm | 1.0 |

### Legs

Legs gain +4 % move speed per level on top of their perks.

| Legs | Speed | Dash (distance, charges, recharge) | Max HP | Special | Lv3 · Lv5 perk | Visual | Slice / 1.0 |
|---|---|---|---|---|---|---|---|
| Scrap Stilts | 5.0 m/s | 4 m, 1, 2.5 s | +0 | — | +1 charge · the dash drops scrap caltrops (Slow) | Mismatched pipe stilts | Slice (legs cache) |
| Sprinter Legs | 6.5 m/s | 5 m, 2, 2.5 s | −10 | +10 % pickup radius | 3 charges · dashing through enemies deals 20 | Digitigrade runner legs | Slice |
| Stomper Legs | 4.5 m/s | Stomp: 3 m shockwave, 30 damage, knockback, voxel damage; 3 s | +20 | Immune to knockback | 4 m radius · the stomp Stuns 1 s | Hydraulic pistons, huge feet | Slice |
| Reverse-Joint Jumpers | 5.5 m/s | Leap 6 m over walls and crowds; landing 20 (AoE 2 m); 3 s | +0 | The leap ignores terrain | 8 m leap · the landing Stuns | Bird-like reverse knees | 1.0 |
| Hover Skids | 6.0 m/s | 5 m, 1, 2 s | −5 | Drifts; ignores slowing terrain (sludge, rubble, fire) | +1 charge · burning wake (10/s) | Hovering skid plates | 1.0 |
| Tread Base | 4.0 m/s | Ram: a 1 s charge that crushes fodder (40); 4 s | +40, +10 armour | Immune to Slow and knockback | +20 max HP · the ram breaks walls | Tank treads | 1.0 |

### Cores

Cores gain +10 % meter charge per level on top of their perks. The meter holds 100 energy.

| Core | Meter charge | Overclock (on a full meter) | Passive | Lv3 · Lv5 perk | Visual | Slice / 1.0 |
|---|---|---|---|---|---|---|
| Cracked Core | 2/s + 1 per 10 kills | 5 s: +40 % fire rate, +20 % speed | — | Overclock +1 s · +25 % charge | Cracked amber cell that sputters | Slice (starter) |
| Overclock Core | ×1.25 | 5 s: +60 % fire rate, +20 % speed | +5 % fire rate | Overclock +1 s · passive +10 % fire rate | Exposed coils and a fan | Slice |
| Fusion Cell | ×1.5 | 7 s: +40 % fire rate, +20 % speed, regenerate 5 HP/s | +10 max HP | Overclock +1 s · the meter starts full after a Shatter | Sealed glowing cylinder | 1.0 |
| Volatile Core | ×1.0 | 6 s: +50 % fire rate, +30 % damage. Ends in a 6 m blast (100 × damage scale, voxel damage) that costs PATCH 10 % HP. | — | Blast 8 m · no self-damage | Leaking orb with hazard stripes | 1.0 |

### Plating

Plating comes from part-upgrade cards or the fabricator (80 × g² per level). All levels are in the slice.

| Level | Max HP | Armour | Visible pieces |
|---|---|---|---|
| 1 | +15 | +8 | Shoulder plates |
| 2 | +30 | +16 | Chest plate |
| 3 | +45 | +24 | Shin guards |
| 4 | +60 | +32 | Visor ridge and forearm plates |
| 5 | +75 | +40 | Full riveted kit |

### Anomalous quirks

Anomalous parts (magenta) roll one quirk. Numbers are applied on top of the ×1.5 rarity multiplier.

| Quirk | Upside | Downside | Slice / 1.0 |
|---|---|---|---|
| Unstable | +40 % damage | 5 % chance per attack to jam for 1 s | Slice |
| Echo | Every attack repeats at 50 % after 0.5 s | −15 % range | Slice |
| Phase | Projectiles pass through walls | −20 % damage | Slice |
| Hungry | +30 % fire rate | Drains 1 scrap/s from the balance while firing | 1.0 |
| Glitched | +50 % crit chance | Targeting mode changes at random every 10 s | 1.0 |
| Magnetic | Gems within 6 m fly to PATCH | Leeches and Wasps prefer PATCH | 1.0 |

### Caches

| Cache | Where | Contents | Open | Slice / 1.0 |
|---|---|---|---|---|
| Legs cache | A few tiles from the husk spawn (guaranteed) | Scrap Stilts | Hold 1 s | Slice |
| Part cache | Inner, mid and outer rings (about 1 per 90 s of roaming) | Choose 1 of 2 parts; rarity by ring | Hold 1 s | Slice |
| Chip cache | Mid and outer rings | Choose 1 of 2 chips (new, or +1 level) | Hold 1 s | Slice |
| Scrap cache | Anywhere outside the Yard | Gem burst worth 20 × *B*(t) × m(d) | Smash it | Slice |
| Military cache | Breacher Prime drop | Choose 1 of 2, Military or better | Hold 1 s | Slice |
| Elite cache | Elites and bosses | The fusion if one is eligible; otherwise choose 1 of 3, Military or better | Hold 2 s | Slice |
| Corrupted Cache | [Event](#events) | One Anomalous part | Hold 2 s | Slice |

Rarity weights (%):

| Source | Scrap | Salvaged | Military | Halcyon | Anomalous |
|---|---|---|---|---|---|
| Inner ring (*d* < 0.35) | 50 | 40 | 10 | 0 | 0 |
| Mid ring (0.35–0.7) | 20 | 45 | 30 | 5 | 0 |
| Outer ring (*d* > 0.7) | 5 | 30 | 45 | 18 | 2 |
| Level-up new-part card, L1–9 | 60 | 30 | 10 | 0 | 0 |
| Level-up new-part card, L10–19 | 25 | 40 | 30 | 5 | 0 |
| Level-up new-part card, L20+ | 10 | 35 | 40 | 15 | 0 |
| Elite and Military caches | 0 | 20 | 50 | 25 | 5 |

## Chips

Chips have levels 1–3. The level-3 bonus comes on top of the per-level value. A fusion needs the chip at any level.

| Chip | Tag | Per level | Level-3 bonus | Fusion key | Slice / 1.0 |
|---|---|---|---|---|---|
| Capacitor | Arc | +20 % Arc damage | +1 chain jump | Arc Welder → Stormbreaker Fist | Slice |
| Ballistics Co-processor | Kinetic | +10 % Kinetic damage, +15 % projectile speed | +1 pierce | Rivet Driver → Rivet Storm | Slice |
| Thermal Regulator | Thermal | +10 % Thermal damage, Burn +1 s | Burning enemies Overheat (they detonate on death) | Plasma Cutter → Sunderbeam | Slice |
| Servo Booster | — | +8 % fire rate | +5 % move speed | — | Slice |
| Magnet Coil | Utility | +30 % pickup radius | Caches open 50 % faster | — | Slice |
| Foreman Protocol | Engineer | +20 % build speed, +5 % structure HP | +1 build drone | — | Slice |
| Shaped Charge | Explosive | +12 % blast radius | No self-damage from your own explosions | Mortar Arm → Quake Mortar | 1.0 |
| Structural Analyzer | Demolition | +20 % voxel damage; outlines load-bearing elements | Crush damage +25 % | Grapple Claw → Wrecking Hook | 1.0 |
| Salvage Protocol | Demolition | +15 % demolition scrap (before decay) | Collapses you cause drop a salvage pile | Scatter Cannon → Scrap Hurricane | 1.0 |
| Drone Firmware | Drone | +10 % drone damage | +1 drone for every drone part and tower | Drone Bay → Murmuration Bay | 1.0 |
| Overclock Buffer | Core | Overclock +1 s | Overclock start emits a 6 m knockback pulse | Optic Laser → Halo Lance | 1.0 |
| Homing Beacon | Utility | A second Recall within 20 s (+10 s per level) returns PATCH to where it left | Recall cooldown −20 % | — | 1.0 |

## Fusions

Recipe: level-5 part + its chip + opening any elite cache ([rules](01-gdd.md#body-as-loadout)). A fused part cannot level further; the chip stays equipped.

| Fusion | Recipe | Effect | Visual | Slice / 1.0 |
|---|---|---|---|---|
| **Stormbreaker Fist** | Arc Welder + Capacitor | Chains to 8 targets and forks; each jump Stuns 0.5 s; arcs leap into metal props and transformers and set them off; ×2.5 Arc damage versus Lv5 | Gauntlet crackling around a storm cell | Slice |
| **Rivet Storm** | Rivet Driver + Ballistics Co-processor | Triple barrel, 6 shots/s; rivets pierce everything and pin enemies near walls (Stunned 0.5 s) | Rotary riveter | Slice |
| **Sunderbeam** | Plasma Cutter + Thermal Regulator | 14 m beam that slices buildings cleanly (cutting load-bearing elements triggers collapses); Burns and Corrodes | Long molten-blade projector | Slice |
| **Scrap Hurricane** | Scatter Cannon + Salvage Protocol | 360° shrapnel bursts every 1.2 s that shred walls; nearby demolition chunks become extra pellets | Spinning drum barrel | 1.0 |
| **Quake Mortar** | Mortar Arm + Shaped Charge | Shells burrow and erupt as 4 m quakes: Stun 1 s, and weakened structures collapse | Seismic tube arm | 1.0 |
| **Wrecking Hook** | Grapple Claw + Structural Analyzer | Every 8 s, hooks a load-bearing element and pulls a whole building section down onto the swarm; normal throws in between | Wrecking hook on a chain | 1.0 |
| **Murmuration Bay** | Drone Bay + Drone Firmware | 12 micro-drones fly as one flock, weaving through the swarm (6 × 2/s each) | Hive-like drone rack | 1.0 |
| **Halo Lance** | Optic Laser + Overclock Buffer | During Overclock the beam sweeps 360°; otherwise the beam is 50 % longer | Halo-ring emitter | 1.0 |

---

## Towers

### Structures at Mk I

Footprints are in build-grid tiles. Build times assume the Forge's 2 starting drones. Tower HP is ×1.5 at Mk II and ×2.2 at Mk III; walls are listed separately below.

| Structure | Role and tags | Tiles | Cost | Power | HP | Range | Hits | Mk I effect (default targeting) | Build | Slice / 1.0 |
|---|---|---|---|---|---|---|---|---|---|---|
| Rivet Turret | Kinetic, single target | 1×1 | 60 | 2 | 300 | 12 m | Ground, air | 10 × 2.5/s = 25 DPS (Nearest) | 4 s | Slice |
| Flame Vent | Thermal, cone | 1×1 | 75 | 2 | 350 | 5 m cone | Ground | 20 DPS + Burn (3 s, 4/s) (Nearest) | 4 s | Slice |
| Arc Pylon | Arc, chain | 1×1 | 100 | 3 | 250 | 9 m | Ground, air | 14 × 1.2/s, 4 jumps at −15 % each (Chain) | 5 s | Slice |
| EMP Spire | Control | 1×1 | 110 | 3 | 300 | 8 m pulse | Ground, air | Every 4 s: 10 damage, Stun 1 s (fodder), Slow 2 s, specialists' shields and abilities off for 3 s | 5 s | Slice |
| Mortar | Explosive, Demolition | 2×2 | 150 | 4 | 400 | 5–24 m | Ground | 60 (AoE 2.5 m) × 0.4/s; **damages voxels** (Strongest) | 7 s | Slice |
| Scrap Wall | Structure | 1×1 per segment | 8 (+1 per 10 standing) | 0 | 400 | — | — | Voxel wall segment; lines are drag-painted | 1 s | Slice |
| Laser Fence | Thermal, gate | Two 1×1 posts up to 4 tiles apart | 120 | 3 | 300 per post | Beam | Ground, air | 40 DPS to anything crossing; does not block paths | 5 s | 1.0 |
| Harvester | Economy | 2×2 | 140 | 2 | 400 | 12 m | — | Grinds rubble in range into scrap (5/s while rubble lasts; demolition decay applies) and collects gems in range | 6 s | 1.0 |
| Repair Bay | Support | 2×2 | 130 | 3 | 500 | 8 m | — | Repairs structures at 20 HP/s × g, split between them; heals PATCH 5 HP/s | 6 s | 1.0 |
| Railgun | Kinetic, Demolition | 2×2 | 220 | 5 | 450 | 40 m line | Ground | 400 per shot every 3 s, pierces everything, and **bores a channel through buildings** wide enough to open a new path (Strongest) | 8 s | 1.0 |
| Decoy | Control | 1×1 | 70 | 1 | 600 | 15 m | — | Every 20 s, projects a PATCH hologram for 8 s that Magnetizes fodder in range toward it | 3 s | 1.0 |
| Drone Hangar | Drone | 2×2 | 180 | 4 | 450 | Yard | Ground, air | 3 combat drones (10 DPS each) + 1 repair drone (10 HP/s × g) (Nearest) | 7 s | 1.0 |
| Generator | Power | 2×2 | 200 | Supplies +8 | 600 | — | — | Snipers and Jammers target it first; explodes when destroyed (Arc 60, 4 m) | 7 s | 1.0 |

### Upgrades and Mk III branches

| Structure | Mk II (1.5 × base) | Mk III branch A (3 × base) | Mk III branch B (3 × base) |
|---|---|---|---|
| Rivet Turret | 14 × 3/s = 42 DPS, 13 m | **Gatling:** 12 × 8/s = 96 DPS, ±5° spread | **Marksman:** 60 × 1.2/s = 72 DPS, pierce 3, ignores Enforcer shields, 20 m, Strongest |
| Flame Vent | 34 DPS, 6 m | **Inferno Ring:** 360°, 55 DPS, 5 m | **Napalm Line:** 45 DPS; leaves burning ground for 4 s (10/s) |
| Arc Pylon | 18 damage, 6 jumps | **Storm Coil:** 10 jumps, each Stuns 0.3 s | **Arc Lance:** single target, 120 × 1/s, +100 % against elites and bosses (never the Prime) |
| EMP Spire | 10 m, Stun 1.5 s | **Disruptor:** pulses strip elite modifiers for 5 s and interrupt boss attacks | **Stasis Field:** constant 50 % Slow and 8 DPS aura, no Stun |
| Mortar | 90 damage, 3 m | **Bunker Buster:** 220 × 0.3/s, heavy voxel damage that brings buildings down on purpose | **Airburst:** 4 × 40 bomblets over 4 m, **no voxel damage** (safe near your walls) |
| Scrap Wall | **Plated:** 800 HP | **Spiked:** 1,000 HP, 12 DPS to attackers | **Reactive:** 1,000 HP; explodes when destroyed (80, 3 m, knockback) and leaves rubble |
| Laser Fence | 65 DPS, posts up to 5 tiles apart | **Grid:** double beam that also Slows 30 % | **Cutter:** also cuts voxels in the gate line; ×2 against flyers |
| Harvester | 20 m, 8/s | **Refinery:** +25 % rubble scrap (before decay) | **Magnet Mast:** pulls gems from 30 m and Magnetizes fodder within 12 m toward itself |
| Repair Bay | 12 m, 35 HP/s × g | **Rebuilder:** rebuilds one destroyed tower per assault at 50 % HP | **Nanite Mist:** +25 % max HP for structures in range |
| Railgun | 600 per shot every 2.5 s | **Overpenetrator:** a wider bore that can bring buildings down | **Stabilised:** no terrain damage, +100 % against bosses and elites |
| Decoy | 12 s projection | **Bomb Decoy:** explodes when the projection ends (150, 5 m) | **Mirror Decoy:** reflects 50 % of projectile damage |
| Drone Hangar | 4 combat drones | **Wing:** drones escort PATCH out to the mid ring | **Interceptors:** ×2 against flyers; Wasps first |
| Generator | Supplies +12 | **Overcharged:** supplies +16, bigger explosion | **Hardened:** −50 % damage taken, immune to Jammers |

### Forge upgrades

Forge upgrades come from level-up cards and the fabricator ([Base and towers](01-gdd.md#base-and-towers)).

| Upgrade | Per rank | Ranks | Source | Slice / 1.0 |
|---|---|---|---|---|
| Reinforce | Forge max HP +25 % | 4 | Card, fabricator | Slice |
| Capacitor Bank | +5 Power | 4 | Card | Slice |
| Power Cell | +5 Power | Repeatable | Fabricator, 150 × 1.8ᵏ | Slice |
| Shield Emitter | Forge shield +5 s | 2 | Card | Slice |
| Drone Dock | +1 build drone | 3 | Card, fabricator | Slice |
| Munitions | Towers +15 % damage | 5 | Card | Slice |
| Perimeter | Yard radius +2 tiles | 3 | Card | Slice |
| Backup Kernel | +1 reboot charge | 1 | Fabricator, 400 × g² | 1.0 |
| Beacon Relay | Recall cooldown −10 s | 2 | Card | 1.0 |

---

## Enemies

All enemies belong to the Sweep: cyan/white, with role-specific silhouettes ([characters](03-art-audio.md#characters)). TP is the threat-point cost the director pays. Scrap is paid out at 1 per TP, × m(d).

### Fodder (GPU swarm units)

| Unit | HP | Speed | Damage | TP | Behaviour | Counters | Slice / 1.0 |
|---|---|---|---|---|---|---|---|
| Mite | 6 | 4.0 m/s | Contact 4/s | 1 | Chases PATCH in clouds of 20–60 | Any AoE, Arc chains | Slice |
| Scrubber | 20 | 2.5 m/s | Contact 6/s; 8/s against structures | 2 | Chaser. In assaults it follows the base field and chews through whatever blocks it. | Walls plus turrets, Flame Vent | Slice |
| Hover Wasp | 12 | 5.0 m/s, flying | Dive 10 (0.4 s wind-up), every 2 s | 2 | Ignores walls; orbits, then dives. In assaults it goes for towers. | Rivet Turret, Arc Pylon, drones (Flame Vents and Mortars can't hit it) | Slice |
| Crawler Mine | 30 | 1.8 m/s | Blast 40 in 3 m, when within 1.5 m or on death; also hits the swarm and voxels | 3 | Crawls toward PATCH or towers; chain-reacts | Kill it at range, or bait it into packs | Slice |
| Shepherd | 90 | 2.2 m/s | Contact 8/s | 8 | Leads up to 40 fodder within 8 m (+20 % speed, holds lanes). When it dies, the pack scatters and is Slowed for 2 s. | Focus fire, Scanner Optic marks | 1.0 |

The Shepherd's leader-follower steering needs a small leader table in the swarm (to verify in M2, [pass chain](../engine/05-gpu-swarm.md#pass-chain)).

### Specialists (CPU actors)

| Unit | TTK | HP at 0:00 / 10:00 / 20:00 | Speed | Damage | TP | Behaviour | Counters | Slice / 1.0 |
|---|---|---|---|---|---|---|---|---|
| Enforcer | 4 s | 80 / 480 / 1,440 | 2.0 m/s | Slam 25 (1 s telegraph, 3 m cone) | 20 | A 120° front shield blocks projectiles; pushes toward PATCH or the Forge | Flanking, beams, arcs, AoE, Halcyon parts, Marksman | Slice |
| Breacher | 5 s | 100 / 600 / 1,800 | 1.5 m/s (0.8 drilling) | Drill 10/s against PATCH, 40/s against structures | 25 | Drills a straight tunnel to the Forge; the tunnel becomes a new path | Towers and PATCH; walls slow it | Slice |
| Breacher Prime | 8 s | First at 3:00: 311; 960 at 10:00 | Tuned to reach the Forge about 75 s after landing | Breach charge: 20 % of Forge max HP, ignoring the shield; then 5 % per 2 s | — | One per assault. Only PATCH can damage it; tower crowd control lasts half as long; collapses only stun it | PATCH | Slice |
| Sniper | 2 s | 40 / 240 / 720 | 2.0 m/s | 45 per shot (1.5 s laser telegraph), 30 m | 15 | Takes rooftops; targets Generators, then towers, then PATCH within 20 m | Collapse its rooftop; dash off the line | Slice |
| Carrier | 5 s | 100 / 600 / 1,800 | 1.2 m/s, hovering | — | 30 | Releases 8 Mites every 5 s (max 40 alive per Carrier); keeps its distance | Chase it down; Missile Rack | Slice |
| Leech | 1.5 s | 30 / 180 / 540 | 5.5 m/s | Steals 3 scrap/s from the balance while latched (never from the total) | 12 | Latches onto PATCH or vacuums gems; flees to the edge after taking 60 scrap; returns what it stole on death | Dash to shake it off; kill it before it escapes | 1.0 |
| Jammer | 3 s | 60 / 360 / 1,080 | 2.5 m/s, hovering | — | 20 | 8 m EMP field: towers inside are Jammed (offline), and PATCH can't Recall or Overclock inside it | PATCH; EMP Spire Disruptor | 1.0 |

### Elite modifiers

An elite has HP = 10 s × *DPS_exp*(t) (or its base HP, if that is higher), costs 3 × its base TP, and drops an elite cache. It has one modifier before 10:00 and two after (heat 4 adds one).

| Modifier | Effect | Slice / 1.0 |
|---|---|---|
| Armoured | +50 armour; Kinetic damage −50 % | Slice |
| Volatile | Explodes on death (6 m; damages voxels and towers) | Slice |
| Swift | +50 % speed; leaps gaps | Slice |
| Shielded | Regenerating bubble worth 30 % of its HP; regenerates after 4 s | 1.0 |
| Splitter | Splits into 3 half-size copies at 0 HP | 1.0 |
| Magnetic | Bends PATCH's projectiles and pulls gems toward itself | 1.0 |
| Phasing | Every 5 s, passes through walls for 1.5 s | 1.0 |
| Overcharged | Immune to Stun, Shock and EMP; periodic Arc nova (4 m) | 1.0 |
| Commander | Allies within 10 m get +25 % damage and speed | 1.0 |

### Assault compositions

Rust Docks, `high`-tier density. The assault budget is 40 × *B*(arrival) ([pacing chart](01-gdd.md#pacing-chart)). Every assault adds one Breacher Prime on top of its budget.

| Assault | TP | Drop points | Composition | Notes |
|---|---|---|---|---|
| A1, 3:00 | 169 | 1 | 30 Scrubbers, 50 Mites, 10 Wasps, 5 Crawler Mines, 1 Enforcer | Teaches walls and the Prime |
| A2, 6:00 | 410 | 1–2 | 70 Scrubbers, 100 Mites, 25 Wasps, 10 Crawler Mines, 2 Enforcers, 1 Breacher, 1 Sniper | First tunnel |
| A3, 8:30 | 719 | 2 | 120 Scrubbers, 150 Mites, 40 Wasps, 20 Crawler Mines, 4 Enforcers, 2 Breachers, 2 Snipers, 1 Carrier | Two lanes |
| A4, 13:00 | 1,587 | 2 | 280 Scrubbers, 300 Mites, 80 Wasps, 40 Crawler Mines, 8 Enforcers, 3 Breachers, 4 Snipers, 3 Carriers, 1 elite Enforcer | Uses the Demolisher's lane |
| A5, 15:30 | 2,276 | 2–3 | 400 Scrubbers, 450 Mites, 110 Wasps, 60 Crawler Mines, 12 Enforcers, 4 Breachers, 6 Snipers, 4 Carriers, 1 elite | 1.0 swaps some budget for Shepherds, 2 Jammers and 3 Leeches |
| A6, 18:00 | 3,136 | 3 | 550 Scrubbers, 600 Mites, 160 Wasps, 80 Crawler Mines, 16 Enforcers, 6 Breachers, 8 Snipers, 6 Carriers, 2 elites | Three lanes |

## Bosses

Boss HP scales in co-op by × (1 + 0.75(N−1)) ([Co-op rules](01-gdd.md#co-op-rules)). Every boss attack uses shape and motion telegraphs of at least 1 s.

| Boss | Role | Arrives | HP | Signature destruction | Weak point | Reward | Slice / 1.0 |
|---|---|---|---|---|---|---|---|
| **Demolisher** | Mid-boss | 10:00 from the outer ring; reaches the Yard about 90 s later if not stopped | 70 s × *DPS_exp*(10) ≈ 8,400 | Flattens a permanent 3-tile lane toward the Forge | Exhaust stack on its back (+50 % damage) | Elite cache, Military cache, memory fragment | Slice |
| **Warden Titan** | District boss | 20:00; sets up in the mid ring | 120 s × *DPS_exp*(20) ≈ 43,200, plus 3 shield pylons (6 s × *DPS_exp*(20) ≈ 2,160 each) | Stomps collapse buildings within 10 m; its beam cuts through buildings | Chest core, exposed for 2 s after each stomp | Cycle clear, 2 memory fragments | Slice |
| **Hive Queen** | Mid-boss (Neon Bazaar), district boss (The Sump) | 10:00 or 20:00 | 70 s or 120 s × *DPS_exp* | Nests inside a building; undermines buildings when it burrows | Egg sac (+50 % damage) | Elite caches, memory fragment | 1.0 |
| **Sweep Nexus** | Final boss (Halcyon Spire) | 20:00 | 180 s × *DPS_exp*(20) ≈ 64,800 over four phases | De-rez fields erase voxels, your walls included | The core in phase 4 | Ending; heat tiers above 5 | 1.0 |

### Demolisher

- **Clearance march (100–60 %):** walks straight at the Forge at 1.2 m/s, flattening a 3-tile lane. Every 6 s it swings its wrecking ball at PATCH within 10 m (arc decal telegraph).
- **Anchor (60–25 %):** plants itself for 15 s and spins the ball in a 10 m ring (an expanding striped ring). Buildings in the ring collapse, and its hopper launches 6 Crawler Mines every 4 s.
- **Runaway (below 25 %):** ×1.8 speed straight at the Forge. In the Yard it smashes structures for 500 × damage scale per swing.
- **Escort:** 480 TP of fodder (20 s of *B*(10)).

### Warden Titan

- **Siege:** stops in the mid ring behind an invulnerable shield dome. Its artillery hits the Forge every 5 s (impact circles; 3 % of Forge max HP each, blocked by the Forge shield while that lasts). Three shield pylons, 20 m out, each spawn a Breacher every 20 s. Destroying all three drops the dome.
- **Advance (100–40 %):** walks at the Forge at 0.8 m/s. Every 8 s it stomps (a 10 m shockwave ring that collapses buildings). A sweeping cyan beam, telegraphed by a thin line for 1.5 s, cuts through buildings.
- **Overclock (below 40 %):** summons a 1,000 TP mini-assault at every drop point, beams twice as often, and each stomp releases 30 Mites. Heat 10 adds a fourth phase: a second dome with four pylons.
- **Escort:** 2,970 TP (30 s of *B*(20)).

### Hive Queen (1.0)

- **Nest:** embedded in a building, it takes 80 % less damage until the nest building collapses, so demolish it. It births a Carrier every 15 s.
- **Swarm:** bursts out and chases PATCH. Every 10 s a Mite tide (100 Mites) rolls out in a ring.
- **Burrow (below 30 %):** dives under rubble. Ground cracks telegraph for 1.5 s, then it erupts under a tower or PATCH and collapses whatever stands above.

### Sweep Nexus (1.0)

- **Audit:** de-rez hex fields (a 2 s white-grid telegraph) erase voxels, cover and walls. It hacks up to three towers, which turn cyan and fire on PATCH for 20 s or until EMP'd or hit by PATCH.
- **Purge:** the core hides behind rotating rings of nanite wall that regrow 5 % per second, so PATCH must cut through (Demolition tags help). A Sweep assault lands every 45 s.
- **Mirror:** spawns SWEEP-PATCH, a cyan copy with PATCH's current hardpoints at 50 % stats.
- **Core:** the exposed core. Halcyon-rarity parts deal +50 % damage to it: the stolen tech turns on its makers.

---

## Districts

Palette tokens are named, not specified here ([palette](03-art-audio.md#palette)). In Halcyon districts, environment cyan stays darker and less saturated than Sweep units, so the enemies still read.

| District | Slice / 1.0 | Theme | Palette accents | Hazards | Bosses (mid / district) |
|---|---|---|---|---|---|
| **Rust Docks** | Slice | Container port: gantry cranes, container stacks, warehouses, fuel depots, piers | Rust and Concrete under Night; sodium floodlights kept dimmer than PATCH's orange | Fuel tanks, toppling cranes, transformer yards | Demolisher / Warden Titan |
| **Neon Bazaar** | 1.0 | Stacked night market: stalls, awnings, sign-choked alleys, cable webs | Dense signage in both families (Sodium and Amber, Halcyon cyan and Holo white) over Night and Concrete | Neon signs, gas cookers, live hanging cables (Shock) | Hive Queen / Warden Titan variant |
| **Glasswall** | 1.0 | Corporate glass towers, plazas, skybridges, security posts | Steel and Concrete with Electric blue reflections | Glass rain from collapses, hackable Halcyon security turrets, mirror panels that reflect beams | Demolisher variant / Warden Titan variant |
| **The Sump** | 1.0 | Flooded undercity: pump stations, pipe galleries, sludge canals | Night and Rust with Ember vent glow | Sludge (−40 % ground speed for everyone), methane vents, flood surges | Demolisher variant / Hive Queen |
| **Halcyon Spire** | 1.0 | Pristine corporate campus around the Sweep's core | Holo white and muted Halcyon cyan over Steel | Security laser grids, regrowing nanite walls | Hive Queen variant / Sweep Nexus |

| District | Material mix (structure voxels) | Demolition H | Signature rule |
|---|---|---|---|
| Rust Docks | Steel 35 %, sheet metal 25 %, concrete 25 %, container steel 10 %, glass and neon 5 % | 2,500 | Cranes topple into container lines: instant walls or chokepoints |
| Neon Bazaar | Brick 30 %, steel 20 %, wood 20 %, concrete 15 %, glass and neon 15 % | 2,500 | Narrow alleys are natural chokepoints; falling signs are crush weapons |
| Glasswall | Glass 35 %, steel 30 %, concrete 25 %, composite 10 % | 2,000 | Glass breaks in one stage, so collapses are fast and pay little |
| The Sump | Concrete 40 %, pipe steel 25 %, brick 20 %, sludge crust 15 % | 3,000 | Flood surges spread sludge over low streets for 30 s |
| Halcyon Spire | Composite 40 %, glass 25 %, steel 20 %, nanite plate 15 % | 1,500 | Nanite walls regrow 1 % per second; Halcyon rarity drops more often |

### Materials

Materials are stored in the voxel's material bits ([voxel storage](../engine/06-world.md#voxel-storage)). Voxel HP is relative to concrete. Tuning anchors:
- a level-1 Plasma Cutter cuts through a 1 m concrete pillar in about 2 s;
- one Mortar shell craters about 1 m³ of concrete;
- a Rivet Driver needs about 10 s of fire to breach a brick wall.

| Material | Voxel HP (concrete = 1) | Raw scrap per m³ | Notes |
|---|---|---|---|
| Concrete | 1.0 | 2 | Dust clouds when broken |
| Brick | 0.75 | 2 | — |
| Steel (beams, plates, pipes) | 3.0 | 8 | Load-bearing pillars and slabs |
| Sheet metal, container steel | 0.6 | 4 | Containers and roofs |
| Glass | 0.25 | 0 | Shatters in one stage; shard hazard |
| Neon and signage | 0.4 | 6 | Sparks Burn when broken |
| Wood | 0.5 | 1 | Flammable; Burn spreads |
| Composite | 2.0 | 10 | Halcyon construction |
| Nanite plate | 4.0 | 4 | Regrows 1 % per second |
| Sludge crust | 0.4 | 1 | Breaks into sludge (Slow) |
| Scrap plate (player walls) | Uses wall HP | 0 | Your own structures pay nothing |
| Reinforced foundation, street layer | Indestructible | — | The Forge's base and the walkable layer |

## Events

The director runs at most one event at a time ([Director and pacing](01-gdd.md#director-and-pacing)).

| Event | Slice / 1.0 | Trigger | Rules | Reward | Risk |
|---|---|---|---|---|---|
| **Data Terminal** (hack and hold) | Slice | 1–2 per Cycle, mid or outer ring, from 3:30 | Stand in the 6 m ring for 30 s in total; progress pauses outside it but never resets. The director sends 3 waves at the terminal, each worth 15 s of *B*(t). | Memory fragment, Military cache, +10 Sparks at run end | Pulls PATCH far from the Forge; a hack started just before a siren is costly |
| **Supply Drop** | Slice | About every 4 min from 4:00, mid or outer ring; a 20 s beacon before landing | The pod crushes whatever it lands on. Opening takes 2 s. Leeches and Scrubbers race to it. | Part cache (ring rarity) plus a gem burst worth 40 × *B*(t) × m(d) | Half the time an elite guards it |
| **Corrupted Cache** | Slice | 1 per Cycle, outer ring, magenta glow | Opening grants an Anomalous part but starts a **Trace**: for 60 s the roaming budget around PATCH is +50 %, and one elite hunts PATCH | One Anomalous part | A Trace can overlap a siren |
| **Rogue Mender** (trader) | 1.0 | 1–2 per Cycle; wanders the mid ring for 90 s | Sells 3 items (parts, chips, a reboot charge) at 80 % of fabricator prices. Trade-in: swap a part for a random part of the same slot, one rarity higher, for 50 % of its price. | A shop in the field | The Sweep hunts the trader; if it dies, its stock drops as caches guarded by an elite |
| **Blackout** | 1.0 | 0–1 per Cycle after 8:00; lasts 45 s | District lights go out except neon, fires and PATCH's glow. Towers fire at 50 % unless a Generator is in range. Fodder is visible only in light (off-screen arrows still work). | Scrap ×1.5 during the Blackout | Visibility; the Blackout visibility floor setting keeps it playable ([Accessibility](01-gdd.md#accessibility)) |
