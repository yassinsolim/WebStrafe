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
secondary, and `3` knife. Fresh and migrated profiles enable auto-bhop by default;
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
| `fire` | `{ weaponId, origin:[x,y,z], dir:[x,y,z], observedAtMs? }` | server validates fire state and resolves the nearest eligible authoritative capsule at a rewind no older than 250 ms |
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
- Backstab readiness is presentation-only: a close, visible, living target that
  is facing away raises the knife, but damage and reach still use the ordinary
  authoritative knife rules with no directional bonus.

## 10. Risks

- **Lag / hit registration feel.** Mitigated by a shared 71 ms presentation
  timestamp and bounded authoritative rewind; timestamps older than 250 ms are
  rejected for compensation.
- **Cheating.** The server derives target, hitbox, distance, and damage. Broader
  anti-cheat hardening remains outside the current scope.
- **Scope creep.** The PR breakdown + feature flag keep each step shippable.
