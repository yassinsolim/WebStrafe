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
   |                                            |  emits FireRequest
   |  raycast vs CollisionWorld + player capsules|
   v                                            v
HitResolver (pure) --> candidate hit --> MultiplayerClient --> server
                                                                  |
                                          server re-validates:    |
                                          - fire rate / cooldown  |
                                          - line of sight / range |
                                          - target alive          |
                                          - claimed hitbox vs geom |
                                                                  v
                                             CombatState (authoritative)
                                             - apply damage, clamp health
                                             - detect death -> killfeed
                                             - schedule respawn
                                                                  |
                          broadcast Hit / Death / Respawn / health v
                                                        all clients render FX
```

### Hit-detection model (decision)

Two options were considered:

| Model | Pros | Cons |
|-------|------|------|
| **Full server-authoritative** (server ray-traces every shot) | Cheat-proof; canonical | Server needs full collision geometry + player capsules in memory; heavier; lag compensation is complex |
| **Client-detected + server-validated** (chosen) | Simple; responsive; server still owns damage/health and rejects implausible claims (range, rate, LoS, dead target) | Not fully cheat-proof (fine for a hobby/portfolio game) |

**Decision: client-detected, server-validated.** The client computes the raycast
and reports a candidate hit `{ targetId, weaponId, hitbox }`. The server validates
plausibility and is the sole authority on applying damage, death, and respawn.
This matches the game's scope and keeps latency low. A note is left in the code
that upgrading to full server authority is the path if this ever becomes
competitive.

**Critical validation note — the `hitbox` field is the weakest link.** Because
`hitbox` multiplies damage (head = 1.5x-2x), a naive server that trusts the
client's claimed hitbox lets a cheater send `hitbox: 'head'` on every shot,
turning the Deagle into a guaranteed one-shot (63 x 2 = 126 >= 100 HP). PR3 MUST
therefore validate the claimed hitbox against the authoritative target geometry
(target position + fixed head-offset capsule, see §4), and re-derive `distance`
from `origin`+`dir`+`targetId` server-side rather than trusting client-sent
values. Hitbox verification is added to the server validation list in §5.

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
short range).

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
Start simple: two capsules per player — `body` (1.0x) and `head` (headshot
multiplier). Derived from the existing player position + a fixed head offset.
This same head-offset capsule is what the server uses to validate a claimed
hitbox (see §3). Refined later if needed.

## 5. Netcode protocol (extends existing `server/index.ts`)

New **client -> server** messages:

| type | payload | notes |
|------|---------|-------|
| `fire` | `{ weaponId, origin:[x,y,z], dir:[x,y,z], targetId?, hitbox?, seq }` | rate-limited like `attack`; server validates rate, range, LoS, target-alive, **and claimed hitbox vs target geometry** |
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

Until models land, `KNIFE` stays the visible weapon while all combat mechanics run.

## 9. Risks

- **Lag / hit registration feel.** Mitigated by client-detected hits; revisit with
  interpolation/lag comp only if it feels bad.
- **Cheating.** Accepted for scope; server validation (incl. hitbox verification,
  §3) catches the obvious cases.
- **Scope creep.** The PR breakdown + feature flag keep each step shippable.
