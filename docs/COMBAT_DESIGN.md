# Combat System — Design Doc

Status: **Proposed** · Owner: Yassin Soliman · Last updated: 2026-07-01

## 1. Goal

Add ranged player-vs-player combat to WebStrafe on top of the existing surf/bhop
movement and multiplayer foundation. Players can fire hitscan weapons (e.g. AWP,
Deagle), deal damage, die, and respawn, with a kill feed and hit feedback — while
keeping the existing solo time-attack and knife loadout intact.

Non-goals (for now): grenades/projectiles, recoil-spray patterns, team scoring,
buy menu/economy, anti-cheat hardening beyond basic server validation.

## 2. Guiding principles

- **Server-authoritative where it matters.** The server owns health, death, and
  respawn. Clients never self-report their own health.
- **Incremental, tested, reversible.** Each stage is a small PR behind CI, gated
  by unit tests. Pure logic (damage math, weapon defs, health state) is separated
  from rendering/netcode so it can be tested headlessly.
- **Art never blocks engineering.** The system is data-driven; the existing knife
  viewmodel is the placeholder weapon until real models are sourced (§8).
- **Extend, don't rewrite.** Reuse the existing WS protocol, rate limiting, and
  input validation in `server/index.ts`.

## 3. Architecture overview

```
                 fire input (mouse1)
Local player  ---------------------------->  WeaponController (cooldown, ammo)
   |                                            |  origin + direction
   |  local world-impact prediction             |  observed server time
   v                                            v
presentation FX                         MultiplayerClient --> server
                                                                  |
                                             CombatArena validates:
                                             - equip / ammo / cooldown
                                             - origin and direction
                                             - bounded rewind timestamp
                                             - target life/protection state
                                             - authoritative capsule hit
                                                                  v
                                             CombatState (authoritative)
                                             - apply damage, clamp health
                                             - detect death -> killfeed
                                             - schedule respawn
                                                                  |
                     broadcast Shot / Hit / Death / Respawn / health
                                                                  v
                                                        all clients render FX
```

### Hit-detection model (decision)

Two options were considered:

| Model | Pros | Cons |
|-------|------|------|
| **Full server-authoritative** (chosen) | Canonical target, hitbox, distance, damage, and death | Requires authoritative capsule history and bounded rewind |
| **Client-detected + server-validated** | Simple and responsive | A forged target or hitbox claim remains a weak link |

**Decision: server-authoritative capsule resolution.** The client submits only
its shot origin, normalized direction, weapon state, and the server time at which
the remote presentation was observed. `CombatArena` validates the shooter and
origin, rebuilds every eligible target from authoritative state, resolves the
nearest capsule surface and head/body band, then exclusively applies damage,
death, and respawn. Clients never choose the target or hitbox.

Remote players render behind the newest snapshot for smooth motion. Fire messages
therefore use the same 71 ms presentation delay, while the server keeps 500 ms of
position samples and accepts at most 250 ms of rewind. Future, stale, or invalid
timestamps fall back to current authoritative positions.

## 4. Data model

### Weapon definitions (`src/combat/weapons.ts`)
Data-driven, so adding a weapon is a table entry, not new code.

```ts
interface WeaponDef {
  id: 'awp' | 'deagle' | 'knife';
  name: string;
  slot: 'primary' | 'secondary' | 'melee';
  damage: number;          // base body damage
  headshotMultiplier: number;
  range: number;           // max effective range (world units); Infinity for hitscan snipers
  fireIntervalMs: number;  // min time between shots (cooldown)
  magazine: number;        // rounds before reload; 0 = melee
  reloadMs: number;
  falloff?: { start: number; end: number; minMultiplier: number }; // optional range falloff
}
```

Initial table: `AWP` (high damage, slow, `range: Infinity` so it never hits a
silent damage cliff on large maps — effectively one-shot to body/head), `DEAGLE`
(medium damage, faster, finite range with falloff), `KNIFE` (existing melee,
1.45 m reach measured to the visible target-capsule surface).

Weapon slots follow the conventional loadout order: `1` AWP primary, `2` Deagle
secondary, `3` knife and `4` katana. The katana (`src/combat/katana.ts`) uses the
knife's attack rules with its own table: more reach (2.1 m slash, 1.8 m heavy cut,
0.5 m sweep), heavier hits (60 slash, 45 follow-up, 90 heavy, 120 / 180 from
behind), slower swings (0.56 s slash, 1.15 s heavy) and 240 u/s run speed. Two
slashes kill from full health. Fresh and migrated profiles enable auto-bhop by default;
an explicit current-profile opt-out remains respected.

### Health / combat state (`src/combat/CombatState.ts`, server-side authoritative)

```ts
interface PlayerCombat {
  health: number;   // 0..100
  alive: boolean;
  lastFireAtMs: Partial<Record<WeaponId, number>>;
  respawnAtMs: number | null;
}
```

Constants: `MAX_HEALTH = 100`, `RESPAWN_DELAY_MS = 3000`, spawn health `= 100`.

### Hitboxes
Each player is represented by one vertical capsule with a top head band. The
server derives body/head classification from the ray's closest point on that
capsule; no client-provided hitbox is accepted. Refined geometry can be added
later without changing the fire protocol.

## 5. Netcode protocol (extends existing `server/index.ts`)

New **client -> server** messages:

| type | payload | notes |
|------|---------|-------|
| `fire` | `{ weaponId, origin:[x,y,z], dir:[x,y,z], observedAtMs?, targets?, t?, melee? }` | server validates fire state and resolves the nearest eligible authoritative capsule at a rewind no older than 250 ms. `melee: 'primary' \| 'secondary'` marks a knife swing (see section 11); a knife fire without it counts as a slash |
| `reload` | `{ weaponId }` | server tracks ammo/cooldown |
| `equip` | `{ weaponId }` | switch active weapon |

New **server -> client** messages:

| type | payload | notes |
|------|---------|-------|
| `hit` | `{ shooterId, targetId, weaponId, damage, hitbox }` | drives hitmarker + damage number FX |
| `death` | `{ victimId, killerId, weaponId }` | drives kill feed |
| `respawn` | `{ playerId, position:[x,y,z] }` | |
| `health` | `{ playerId, health, alive }` | authoritative health sync |

`MultiplayerSnapshotPlayer` gains `health: number` and `alive: boolean` so late
joiners and respawns stay consistent. All new inputs reuse the existing
validation helpers (`parseVector3`, `parseNumber`) and per-second rate windows.

## 6. Incremental delivery (one PR per stage, all behind CI)

1. **PR1 — Health & damage model (pure logic).** `CombatState` + `weapons` table +
   damage math (falloff, headshot). Vitest unit tests only. No rendering/netcode.
2. **PR2 — Hitscan firing (client).** `WeaponController` (cooldown, ammo, reload)
   + `HitResolver` raycast vs player capsules using the existing `CollisionWorld`.
   Unit-tested against synthetic scenes.
3. **PR3 — Combat netcode.** Extend server + `MultiplayerClient` with the messages
   in §5; server-authoritative damage/death/respawn (including hitbox validation
   per §3); kill feed data.
4. **PR4 — Effects & HUD.** Muzzle flash, tracers, impact decals, hitmarkers,
   damage numbers, health bar, kill feed UI (Three.js sprites/particles + DOM HUD).

Each stage keeps solo play and the knife working; combat is behind a feature flag
(`VITE_ENABLE_COMBAT`) until it's complete.

## 7. Testing strategy

- **Unit (vitest):** damage math, falloff, headshot, cooldown/ammo state machine,
  respawn timing, hit validation (range/rate/dead-target/hitbox rejection).
- **Deterministic hit tests:** `HitResolver` against hand-built capsule positions.
- **Multiplayer E2E:** `tools/mp-e2e-test.mjs` connects two real WS clients to a
  running server and asserts join, state-sync, and attack broadcast. Extended per
  stage to cover fire -> hit -> death -> respawn.
- **Manual E2E:** two browser tabs (or `tools/mp-bot.mjs`) against `npm run dev`.
- CI (typecheck + test + build) must be green on every PR.

## 8. Art / models plan (honest)

The engine is model-agnostic (loads any GLTF via `CosmeticsManager`). Weapon meshes
are the real bottleneck, not the code. Plan, in order of reliability:

1. **CC-licensed models (primary path).** Source game-ready AWP/Deagle GLBs from
   Sketchfab under CC-BY/CC0, wire them into `public/cosmetics/manifest.json` (same
   pipeline as the existing knife). Attribution recorded in the manifest + credits.
2. **Blender (MCP-assisted) for integration.** Import, rescale, reposition to the
   viewmodel origin, retexture, re-export optimized GLB. This is grunt work AI can
   do well.
3. **AI text/image-to-3D (experimental).** Tools like Rodin/Meshy can produce
   stylized placeholder skins; quality is not yet hero-asset grade — managed
   expectations, used only as stopgaps.

Production Deagle and AWP viewmodels preserve their source assets' authored
two-hand rigs, magazines, materials, and reload clips. Runtime playback samples
those clips against authoritative combat progress, while equip/fire feedback
remains a small project-owned presentation layer. The knife keeps its independent
presentation and audio path.

## 9. Runtime firearm-feedback contract

- `CombatArena` remains authoritative and emits `killed` on hits plus `headshot`
  on deaths, so the HUD can choose one normal/headshot/kill confirmation without
  guessing or playing duplicate sounds.
- Firearm rays resolve against rewound authoritative target capsules. The rewind
  is bounded to 250 ms and matches the renderer's 71 ms presentation delay, so a
  shot through a visibly moving player is judged against the position shown.
- Local and observed remote shots create weapon-specific muzzle, short tracer,
  and resolved world-impact effects. Every Three.js object has a bounded lifetime
  and is disposed on expiry, weapon switching, local death, or respawn.
- Deagle and AWP viewmodels share the established camera-space renderer but use
  separate restrained bob, sway, recoil, and reload profiles. Switching to the
  knife clears firearm impulses before restoring the unchanged knife profile.
- Firearm and hit-confirmation sounds are generated with project-owned Web Audio.
  Reload cues align to authored magazine release/drop, insertion, seating, and
  slide/bolt phases and are cancelled on weapon switches. Context creation/resume
  is tied to browser interaction and unavailable or blocked audio is surfaced
  through explicit warnings.
- Bots keep the real `MovementController`, but firing additionally requires
  server-side collision-world line of sight, a reaction delay, imperfect aim,
  finite range, and bounded burst/cooldown windows.
- Backstab readiness is a presentation cue: a close, visible, living target
  that is facing away raises the knife. It uses the same cone as the
  authoritative backstab (section 11), which is what actually applies 90 or 180.

## 10. Risks

- **Lag / hit registration feel.** Mitigated by a shared 71 ms presentation
  timestamp and bounded authoritative rewind; timestamps older than 250 ms are
  rejected for compensation.
- **Cheating.** The server derives target, hitbox, distance, and damage. Broader
  anti-cheat hardening remains outside the current scope.
- **Scope creep.** The PR breakdown + feature flag keep each step shippable.

## 11. Weapon mechanics (v2)

Where the numbers come from:

- **CS2 data:** `scripts/weapons.vdata` from the public
  [SteamTracking/GameTracking-CS2](https://github.com/SteamTracking/GameTracking-CS2)
  mirror, commit `10f3693` (2026-09-23). Balance references only; no assets.
- **Source knife code:** `weapon_knife.cpp` (`SwingOrStab`) for ranges, the
  hull, cooldowns and the follow-up rule. 1 Source unit = 0.0254 m.
- **CS:GO model:** the documented accuracy model (penalty decay, movement
  ramp, jump term) and punch convars (`weapon_recoil_*`, `view_recoil_tracking`).
- **Ours:** values we picked, marked as such.

### Knife (server-authoritative)

Every knife type shares these (`src/combat/knives.ts`). Swings resolve in
`CombatArena.handleMelee` on the WebSocket server and on the Supabase host.

| Rule | Value | Source |
|---|---|---|
| Slash damage | 40, follow-up 25, from behind 90 | CS:GO / CS2 knife table |
| Stab damage | 65, from behind 180 | same |
| Slash cooldown | 0.4 s after a miss, 0.5 s after a hit; the stab waits 0.5 s | `SwingOrStab` |
| Stab cooldown | 1.0 s after a miss, 1.1 s after a hit, both attacks | `SwingOrStab` |
| Follow-up | a slash less than 0.4 s after the slash cooldown ran out | `m_flNextPrimaryAttack + 0.4` |
| Reach | 1.45 m slash, 1.2 m stab, eye to capsule surface | ours; CS reaches about 1.63 / 1.22 m to the target box through its hull trace |
| Sweep | 0.41 m sphere swept along the aim | CS `head_hull`, 16 units |
| Backstab | attacker-to-victim direction dot victim forward above 0.475 | CS:GO (CS:S used 0.8) |

A slash from behind does 90, which does not kill from full health, same as CS.

- **Hit test** (`MeleeResolver`): the swept sphere must touch the target
  capsule, the target must be in front of the attacker, and its surface must be
  within reach of the eye. The nearest target wins. Where the authority has
  collision (the host's world, or the server's headless map once it has loaded
  on the first swing), a wall between the eye and the contact point blocks it.
- **Rewind:** targets are rewound like gun shots. The backstab uses the
  victim's yaw at the rewound time, which now rides in the position history
  from WebSocket clients, Supabase peers and bots.
- **Timing:** the cooldown check uses the client's send time mapped through
  its `SourceClock`, clamped to at most 150 ms before arrival. Network jitter
  no longer rejects swings that were spaced correctly, and claims never run
  ahead of arrival, so swings can't be banked.
- **Protocol:** `fire` carries optional `melee`. Hits and deaths report
  `weaponId: 'knife'`, and `hit` adds `melee` and `backstab`. A confirmed hit is
  also broadcast as a `shot` with `weaponId: 'knife'` and the contact point, so
  the victim gets the incoming-damage cue and everyone can draw blood. The
  client keeps sending `attack` for remote swing visuals.
- **Client:** `LocalKnife` applies the same cooldowns. It predicts hit or miss
  against the remotes as drawn, so the longer cooldown after a hit lines up
  with the server.

### Spread (`src/combat/Inaccuracy.ts`)

The cone is spread + inaccuracy. Inaccuracy is a penalty plus a movement term
plus an air term:

- **Penalty:** sits at the stance floor (stand on the ground, stand + jump in
  the air). Each shot adds `fire`, and a landing adds `land` x fall speed in
  units/s. It decays back to the floor, 90% per recovery time. In the air the
  recovery time is CS's crouch recovery x4.
- **Movement term:** zero up to 34% of max speed, then `move` x ramp^0.25 up
  to 95%, measured against the held weapon's max speed like CS: 250 u/s for
  the knife, 230 for the Deagle, 200 for the AWP and 100 scoped (see
  [movement-cs2.md](movement-cs2.md)).
- **Air term:** from `jumpInitial` at take-off speed down to 0 near the apex,
  using a sqrt of vertical speed, capped at 2x.
- **Sampling:** each shot draws a random radius in [0, inaccuracy] at a
  random angle, plus a second circle of radius spread (CS's two-circle draw).
  The random source is injectable.

| Weapon | spread | stand | jump | fire | move | land / (unit/s) | jump initial | recovery |
|---|---|---|---|---|---|---|---|---|
| Deagle | 0.002 | 0.0042 | 0.04055 | 0.07223 | 0.0481 | 0.000043 | 0.54882 | **0.4 s (ours)**, CS2 0.8112 |
| AWP unscoped | 0.0002 | 0.0808 | 0.13383 | 0.05385 | 0.17648 | 0.000307 | 0.17286 | **0.25 s (ours)**, CS2 0.34539 |
| AWP scoped | 0.0002 | 0.002 | 0.13383 | 0.05385 | 0.17648 | 0.0001 | 0.17286 | same |

All values are radians and come from CS2 unless marked. The two recovery
times follow the design targets: the Deagle recovers in about 0.4 s, and the
scope settles in about 0.3 s (under 0.5 degrees at 0.3 s). CS2's own values
give about 0.8 s and 0.45 s. CS2's `m_flInaccuracyJumpApex` is not modelled,
because its formula isn't public.

### Recoil and view punch (`src/combat/Recoil.ts`)

- Each shot adds aim punch velocity at the CS2 recoil angle (up) plus or
  minus the angle variance. That variance is the horizontal drift.
- The punch decays by `exp(-8 dt)` and then 18 deg/s linear, and the velocity
  decays by `exp(-4.5 dt)` (CS:GO `weapon_recoil_decay2_exp`, `_lin`,
  `weapon_recoil_vel_decay`).
- Bullets go to punch x 2 (`weapon_recoil_scale`). The camera shows 45% of
  that (`view_recoil_tracking`) plus a visual-only kick of magnitude x 0.055
  that decays at 18/s.
- The camera offset is applied in `GameApp.updateCameras` and never changes
  the real view angles.
- Our reading, since the original `Recoil()` isn't public: the magnitude is
  punch velocity in deg/s, and the extra view kick scales with magnitude.

| Weapon | angle | variance | magnitude | result |
|---|---|---|---|---|
| Deagle | 0 | +-60 deg | 48.2 +- 18 | about 2.9 deg peak at 0.11 s, under 5% by 0.37 s |
| AWP | 0 | +-20 deg | 78 +- 15 (unscoped value for every shot, ours) | about 6.5 deg peak, settled in 0.45 s |

### AWP scope (`src/combat/Scope.ts`, `src/ui/ScopeOverlay.ts`)

- **Zoom:** right click cycles unscoped, zoom 1, zoom 2. CS2 zooms to 40 and
  10 degrees against a 90 degree base. We keep that magnification (about 2.7x
  and 11.4x) for any world fov and ease over CS2's 0.05 s zoom time.
- **Sensitivity:** zoomed fov / base fov x the zoom sensitivity ratio (CS
  default 1.0). The ratio is read from `settings.zoomSensitivityRatio` when
  present, otherwise 1.0.
- **Firing:** a shot unscopes. After the 1.5 s bolt the scope comes back at
  the same zoom if the AWP is still out, the player is alive and not
  reloading. The zoom is locked during the bolt, as in CS. Reload, weapon
  switch, death and pause unscope.
- **Presentation:** the overlay is original (black mask, one lens, faint
  vignette, thin cross with heavier outer posts). The crosshair and the
  first-person gun are hidden while scoped.

### Impact feedback (`src/combat/CombatEffects.ts`, `src/combat/ImpactDecals.ts`)

- **Bullet holes:** pooled oriented quads, at most 64, with the oldest
  reused. Each holds for 12 s and fades over 3 s. They are cleared on map
  load and kept across weapon switches and respawns.
- **World hits:** a dust and spark puff.
- **Player hits:** a blood puff at server-confirmed endpoints only: remote
  shots, our own confirmed gun hits and every knife hit. Never on the local
  victim.
- **Local rounds:** a local round stops at a drawn player instead of marking
  the wall behind.
- **Muzzle flash:** the local flash can follow the real muzzle socket through
  `getLocalMuzzleWorldPosition`. The fixed anchors remain the fallback.
