# Combat Bots — Design

Goal: **bots that surf the map with real physics (no noclip) and fight with the
real, server-authoritative combat system** — not the dumb WebSocket puppets that
teleported through walls and machine-gunned the knife sound.

This is the natural extension of the combat epic (#6–#12): reuse the same
`MovementController` + `CollisionWorld` the human client uses, and the same
`CombatArena` the server already trusts for damage.

## Why server-side

Combat is already server-authoritative (`CombatArena` re-derives every hit from
authoritative positions). Bots must be too, so all clients see identical bot
positions/hits and no client can be "the bot host". The physics core is pure and
runs headlessly (proven by `SurfCollisionWorld.test.ts`), so the server can run
`MovementController` per bot against the real map geometry.

Bots are injected into the normal player snapshot, so **every client renders
them through the existing `RemotePlayersRenderer` with zero client changes.**

## Architecture

```
server/index.ts
  ├─ CombatArena            (existing) authoritative health/hits/respawn
  ├─ BotManager             (PR2) owns bots per map, ticks sim, injects into snapshot
  │    └─ BotController[]    (PR2) MovementController + AI (movement PR2, combat PR3)
  └─ mapCollision.ts        (PR1) loads collision.glb → CollisionWorld (Node, cached)
```

### PR1 — headless server collision (this PR)

- `server/glb.ts` — `stripMaterialsFromGlb()`: removes materials/textures/images
  from a GLB so three's `GLTFLoader` parses **geometry only**, headlessly, with
  no texture-load spam. (The real `collision.glb` is 61 MB but only ~83k tris;
  the bulk is embedded textures we don't need.)
- `server/mapCollision.ts` — `loadHeadlessMap(mapId)`: reads `collision.glb` +
  `meta.json`, parses to a `CollisionWorld`, resolves spawn, cached per map.
  Aliases the browser `self` global to `globalThis` so `GLTFLoader` runs in Node.
- Tooling: `server/**` is now type-checked (added to `tsconfig` + `@types/ws`),
  and `vitest` picks up `server/**/*.test.ts`.
- No bots spawned yet; `server/index.ts` runtime is untouched.

### PR2 — bot manager + movement AI

- `BotController`: wraps a `MovementController`; an AI produces `MoveInput`
  (`forwardMove`/`sideMove`/`jump`) + look deltas to seek the nearest living
  player. Ground-clamped by the real `CollisionWorld` → **no noclip**. On ramps
  the real surf physics carries it (slides under gravity).
- `BotManager`: spawns N bots per active map, ticks the sim at a fixed step
  (decoupled from the 20 Hz snapshot), and contributes bot rows to the snapshot
  `players` list. Registers each bot in the arena (`addPlayer`) so it has health.
- Feature-flagged (`ENABLE_BOTS`, off by default) and bounded (max bots/map).

### PR3 — bot combat

- Bots aim at the nearest visible player and fire via `CombatArena.handleFire`,
  producing the same `hit`/`death`/`health`/`respawn` broadcasts as human fire.
- Bots take damage, die, and respawn through the arena like any player.
- Simple fairness knobs: fire cadence, aim error, reaction delay.

## Current Combat Behavior (2026-10-09)

- Dead authoritative snapshot rows are not rendered or offered as displayed
  targets. Respawning creates a fresh displayed pose at the spawn point rather
  than interpolating from the old standing body. This removes the dead model;
  it does not add a ragdoll or corpse animation.
- A visible target no longer freezes the bot in place. After acquisition it
  advances to engagement distance, alternates lateral strafes, and backs away
  when the target is too close. Airborne bots continue tracking target height.
- Tracking is capped at 3.2 radians per second. Aim wander uses a 0.0075-radian
  base and caps its world-space amplitude at 0.20 m. Firing also requires
  alignment within a 0.14 m window at the target's distance, rather than
  accepting a fixed angle that misses by metres at range.
- The acquisition hold, reaction delay, first warning shot, line-of-sight
  checks, PvP eligibility, tap cadence and burst cooldown remain. Bots do not
  acquire hidden live positions or shoot through geometry.
- Seeded flat-ground tests cover moving targets at 15, 40 and 80 m, require
  more than 2 m of lateral movement, and require over 60% hits after the three
  scripted opening rounds. Actual hit rate still depends on movement and cover.

## Non-goals / honest limitations

- **Pro-level air-strafe AI is out of scope.** These bots use real collision and
  real surf physics, so they slide realistically and never noclip, but they do
  not (yet) execute optimal air-strafe gains on ramps. That's a future
  enhancement, not a correctness issue.
- Server-side wall occlusion for bot LOS uses the same collision world; human
  LOS remains as documented in `COMBAT_DESIGN.md`.

## Testing strategy

- PR1: pure GLB-strip unit tests + an integration test that loads the real surf
  collision headlessly (geometry non-empty, spawn in-bounds, cached).
- PR2/PR3: deterministic `BotController` unit tests (fixed inputs → expected
  intent) and a WS harness that connects a fake client and asserts bots appear
  in snapshots, move on geometry, and deal/take damage — the same style as the
  combat E2E harnesses.

The live browser regression uses an isolated local WebSocket backend with
`ENABLE_BOTS=true`, `BOTS_PER_MAP=1`, and a client forced to
`VITE_MULTIPLAYER_TRANSPORT=ws`. When testing through a LAN URL, set the
backend's `WEBSTRAFE_ALLOWED_ORIGINS` to that exact client origin; localhost
is allowed by default, LAN origins are not.

```sh
CHROME=<test-chromium> PLAYWRIGHT_MODULE=<playwright-index.mjs> \
  node tools/qa/bot-combat-check.mjs http://<lan-ip>:<vite-port> <output-directory>
```

It waits for natural bot movement and damage, kills the bot through the
player's normal firing path, verifies the dead server row removes the rendered
actor, then verifies the actor returns on respawn. It captures alive/dead/
respawn screenshots and a JSON report. Cloud multiplayer is not used.
