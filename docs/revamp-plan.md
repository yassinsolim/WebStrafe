# WebStrafe revamp plan

Status: phase 1 in review (branch `revamp/netcode-phase1`) · Last updated: 2026-09-26

Goal: make WebStrafe play like a CS2/CS:GO bhop and surf server. That means
Source-accurate bhop and air strafing, surf that keeps working, proper netcode,
a sniper, a heavy pistol and a full knife roster. All of it runs in the browser.

## 1. Why multiplayer felt buggy and laggy

Everything below was measured, not guessed. The numbers come from
`tools/netbench/` (see section 8). The bench runs two bot players circling at
16 m/s (a fast bhop pace) and one shooter that renders them with the real
`RemotePlayersRenderer` and fires at exactly where it sees them. With perfect
aim, the correct hit rate is 100%.

### What is actually live

- `strafe.yassin.app` is a static Vercel build. Its bundle has a Supabase
  project URL baked in and loads `SupabaseMultiplayer`. Production
  multiplayer is **Supabase Realtime broadcast**, and one player's browser tab
  is elected host. That tab runs the bots and resolves every shot.
- The Node WebSocket server (`server/index.ts`, `Dockerfile`, `fly.toml`) exists
  in the repo but was never deployed as far as anything public shows.
  `fly.toml` still has the placeholder app name and `iad`, and no
  `*.fly.dev` host for it resolves. History: PR #18 scaffolded Vercel + Fly,
  and PR #19, merged the same day, switched production to Supabase.
- The deployed commit (`f372f70`) is an empty commit on top of `910bb4a`,
  so live code equals `main`.

### Failure modes, ranked by impact

| # | Failure | Evidence |
|---|---------|----------|
| 1 | **Lag compensation used the wrong clock in Supabase mode.** The shooter sent its own `Date.now()` as "server time", but the host compared it against the host's clock. Any skew above a few ms, or a future timestamp, silently disabled rewind. | Supabase bench, shooter clock 150 ms off (normal for home PCs): **0 of 29** perfect-aim shots hit. With zero skew: **6 of 34 (17.6%)**. |
| 2 | **Remote players had no timeline.** Rows carried no sample time. The client chased the newest position with exponential smoothing (rate 14/s). Fast players were drawn about 2 m behind, stuttered whenever packets bunched, and the server's 71 ms rewind guess didn't match what was on screen. | WebSocket bench on a perfect LAN link: drawn 2.06 m behind at p50, stutter (p95 per-frame speed error) 0.45, hit rate 63%. At 60 ms RTT: 45%. At 150 ms RTT with jitter and loss: **6.5%**. |
| 3 | **Three free-running 20 Hz timers stacked up.** The game sent states on a reset-to-zero accumulator (actually 18.3 Hz at 128 Hz ticks). The transport resampled on its own `setInterval`, and receivers rebuilt snapshots on a third timer. That created duplicated and skipped samples plus up to about 100 ms of aliasing delay. | Unit test pins the 18.3 Hz. Supabase bench p95 stutter was 0.80 and 2.5% of frames froze. |
| 4 | **The host tab runs the match.** Browsers throttle timers in hidden tabs. With the old 100 ms dt clamp, bots moved at 1/10 speed and bot and combat broadcasts dropped to about 1 Hz for everyone while the host was alt-tabbed. | Headless Chromium: the host loop runs 58.8 Hz in the foreground and **1.2 Hz** hidden, with 992 ms median gaps (`tools/netbench/tab-throttle.mjs`). |
| 5 | **Supabase traffic ignored the per-project event budget.** One idle, paused player's tab broadcast `botstate` at 58.6 Hz (283 B) plus `state` at 20 Hz (253 B), about 79 msgs/s. Supabase bills sent plus delivered per receiver, and the free plan caps at 100 events/s. Two players come to about 200/s. | Live capture of the production lobby. A 15 s replay at about 280 events/s did **not** trip `tenant_events` on this project, so this is a documented risk and cost driver, not the observed failure. It becomes the limit as rooms grow, because traffic is O(N²). |
| 6 | **Presence calls were used for per-toggle state.** `setCombatReady` called `track()` on every pause and unpause. Supabase allows 5 presence calls per client per 30 s. | Documented limit. It's a source of "bots ignore me or won't stop" reports after rapid pausing. |
| 7 | **The anti-teleport origin check rejected fast shooters.** Fire origins more than 3 m from the shooter's last sample were dropped. At surf speeds and low update rates, a legit origin is that far ahead. | Unit test: a shooter at 30 m/s with a 200 ms-old sample is rejected before the fix and accepted after. |
| 8 | **Relay latency.** Supabase relays every message through its region. | Calgary to Supabase to Calgary, one-way p50 48 ms and p99 65 ms, even with both players in the same city. |

Things that were fine: the `ws` server disables Nagle (`setNoDelay`) and has
`perMessageDeflate` off by default. JSON snapshots are about 650 B for three
players. The Node server loop timing was steady (snapshot spacing p99 within
3 ms of nominal). There is no local-player rubber-banding today because each
client is authoritative over its own movement. That is also why movement
isn't cheat-proof (see phase 2).

## 2. What phase 1 changed (this PR)

- `src/netcode/`: a `SourceClock` (min-offset clock mapping, so no clock sync
  is needed), an `InterpolationBuffer` (Hermite with sent velocities, a 250 ms
  bounded extrapolation, teleport snap), a `RemoteTimeline` (slewed render
  delay, never runs backwards), `SendCadence` (tick-driven, keeps phase),
  `RateBudget`, and `PredictionLedger` + `ErrorSmoother`.
- Every state and snapshot row carries its sample time and clock. Fires carry
  the exact time each target was rendered at, in that target's own clock.
  `CombatArena` rewinds each target with the same Hermite math (400 ms cap)
  and projects fast shooters before the origin check.
- WebSocket server: dejittered client samples, drift-free 30 Hz snapshots and
  bot loop, backed-up sockets skipped instead of queued, quantized rows.
- Supabase protocol `p2`: one merged state message per client (bots ride on
  the host's), a room-size send-rate budget, 1 Hz keepalive while paused,
  batched combat events, readiness and host eligibility carried in state
  instead of presence, hidden tabs handing off hosting, and a fixed 60 Hz host
  step. The channel name carries the protocol version, so old and new clients
  never mix.
- Knives: a data model for all 20 CS2 knife types, procedural original models,
  a first-person swap onto the existing animated arms, and a Knives tab in the
  menu (section 5).

### Before and after (perfect aim, 16 m/s targets)

WebSocket server through the delay proxy (`npm run bench:net`), 30 s per profile:

| Link | Hit rate before → after | Drawn behind, p50 (m) | Stutter p95 | Frozen frames |
|------|------------------------|--------------------|-------------|---------------|
| LAN | 63% → **100%** | 2.06 → 1.36 | 0.45 → 0.11 | 0% → 0% |
| 60 ms RTT | 45% → **100%** | 2.96 → 2.23 | 0.45 → 0.10 | 0% → 0% |
| 60 ms RTT, ±15 ms jitter, 2% loss | 50% → **100%** | 3.08 → 2.92 | 0.99 → 0.14 | 4.5% → 0% |
| 150 ms RTT, ±20 ms jitter, 1% loss | 6.5% → **87.5%** | 4.43 → 4.30 | 0.98 → 0.13 | 4.8% → 0.7% |

Supabase, real project from Calgary, three clients (mover host + mover + shooter):

| Case | Hit rate before → after | Stutter p95 | Frozen frames |
|------|------------------------|-------------|---------------|
| Shooter clock 150 ms off | 0% → **100%** | 0.80 → 0.06 | 2.5% → 0% |
| Clocks in sync (before only) | 17.6% | 0.54 | 0.6% |

"Drawn behind" is intentional interpolation delay plus network latency. CS
does the same thing (cl_interp) and hides it with lag compensation, which is
why the hit rate is the number that matters. Bandwidth per WebSocket client
rose from 14.7 to 21 KB/s because snapshots went from 20 to 30 Hz.

## 3. Netcode target (phase 2)

The end state is a **server-authoritative dedicated server**, which is what the
resume describes. Supabase stays as a free fallback for casual rooms.

1. **Tick-stamped inputs.** Clients send `{tick, buttons, wishMove, yaw,
   pitch}` at 64 or 128 Hz, batched about 4 per packet with the last 2 batches
   repeated for loss tolerance. The server buffers 1 to 2 ticks of input per
   player (adaptive, like CS's input buffer) and simulates `MovementController`
   for every player on the same fixed tick.
2. **Prediction and reconciliation.** Already built and tested
   (`PredictionLedger`, `captureState`/`restoreState`). Identical inputs replay
   bit-exactly, and server-only effects (knockback, teleports) are corrected
   with one rollback and replay. Wiring: snapshots carry `ackTick` + the
   player's authoritative state, the client reconciles, and `ErrorSmoother`
   hides the snap. The bench already measures correction magnitudes once this
   is on.
3. **Snapshot interpolation** for remotes. Done in phase 1. Next steps are
   delta-compressed snapshots against the last acked baseline and a binary
   encoding (about 20 B per player instead of about 200).
4. **Lag compensation.** Done in phase 1 per target. Move from capsules to
   per-hitbox rewind (head, chest, stomach, limbs) once player models have
   hitboxes.
5. **Transport.** Stay on WebSocket for now, where TCP head-of-line stalls are
   what cause the remaining 150 ms-RTT misses. Add WebTransport datagrams
   (unreliable, unordered) for snapshots and inputs where supported, with the
   WebSocket as fallback.
6. **Hosting.** Fly.io `sea` (Seattle), not `iad`. Measured from Calgary: 30 ms
   RTT to AWS us-west-2 versus 61 ms to us-east-1. One shared-cpu-1x machine
   handles a few rooms. Add a second region if players aren't in western
   North America.
7. **Anti-cheat basics.** Server movement authority removes speed and teleport
   hacks. Keep the fire-rate and origin checks, and rate-limit inputs.

## 4. Movement: Source-accurate bhop and surf (phase 2)

Status: air strafing done on `v2/movement`. The controller is a 128 Hz
fixed-step kinematic controller with ground, air and surf modes, ramp
clipping, edge slide and BVH collision. Units are metres (1 u = 0.0254 m).

### What was wrong

- **No 30 u/s air wishspeed cap.** Air and surf used the ground `accelerate()`,
  so `addspeed` compared against the full 9.5 m/s wishspeed. Holding a strafe
  key with the mouse still pushed the velocity along that key up to 9.5 m/s:
  9.5 to 13.44 m/s in one jump without turning. `sv_airaccelerate` had been
  lowered to 24 to hide it.
- **Takeoff and landing inside the ground probe band.** The probe reaches
  0.18 m under the feet and everything inside it counted as ground. The first
  4 ticks after a jump ran friction and the ground speed clamp (8.74 to
  7.41 m/s), a held jump re-applied the impulse on each of them, and a landing
  stopped where the probe first saw the floor: the player hovered 0.154 m up
  with gravity off until the next jump. Walking off a 15 cm step did the same.
- **Holding jump on a surf ramp re-fired every tick** while the probe or the
  surf grace ticks still saw the ramp: 20 impulses and 2.77 m of climb from
  one held press on a 55° ramp.

### What changed

- `airAccelerate()` in `MovementMath.ts` is Source's
  `CGameMovement::AirAccelerate`: `wishspd = min(wishspeed,
  sv_air_max_wishspeed)`, `addspeed = wishspd - dot(vel, wishdir)`, return if
  `addspeed <= 0`, `accelspeed = min(sv_airaccelerate * wishspeed * dt,
  addspeed)` with the full wishspeed. Air and surf both use it. Surf now
  accelerates along the horizontal wishdir and lets the ramp clip remove the
  part into the face (Source's `AirMove` then `TryPlayerMove`) instead of
  projecting wishdir onto the ramp. Ground accelerate is unchanged.
- Defaults: `sv_airaccelerate` 150 and the new `sv_air_max_wishspeed`
  0.762 m/s (30 u/s). Nothing else changed, autobhop stays on by default.
- A player rising off the floor (vy > 0 with the feet more than 1 cm up) or
  still falling from past the 0.08 m snap distance is in the air. A grounded
  player with a gap under the feet is put on the floor. Autobhop now takes off
  from the floor every 70 ticks. On a surf ramp only a fresh jump press jumps.
- Per-map cvars: `MapMeta.cvars` (`Partial<SourceCvars>`) is applied by
  `MovementController.applyMapCvars()`. It resets every cvar to its default
  and applies only known names with the right type inside the `mapCvarRules`
  ranges, and returns what it rejected. `GameApp.activateLoadedMap` applies it
  before the movement reset, then re-applies the player's autobhop setting.
  Bhop maps ship `{"sv_airaccelerate": 150}`, surf maps
  `{"sv_airaccelerate": 100}`.
- Strafe stats for the HUD, see below.

### The math

With wishdir perpendicular to the horizontal velocity, `addspeed = W` (W =
0.762 m/s) and `accelspeed = 150 * 9.5 / 128 = 11.1 m/s` gets clamped to it,
so every air tick does v² → v² + W². The gain per tick is sqrt(v² + W²) - v,
about W²/2v: 0.03 m/s at 9.5 m/s and 0.013 m/s at 22 m/s. The velocity turns
atan(W/v) per tick toward the key (4.6° at 9.5 m/s), and the view has to keep
turning at that rate to stay perpendicular. With the view still, one tick
sets the speed along wishdir to W and every tick after that adds nothing.

A jump (5.4 m/s up, g = 19 m/s²) lasts 70 air ticks counting the takeoff tick,
and autobhop has no ground ticks, so a perfect jump adds 70 W² = 40.6 m²/s² to
v². Once `sv_airaccelerate * wishspeed * dt` is above the cap (airaccelerate
above about 10.3 here) the airaccelerate value doesn't change perfect-strafe
gain at all. It sets how hard wrong inputs hit instead: S in the air at
9.5 m/s reverses you to 0.76 m/s backwards in 1 tick at 150, in 2 ticks at
100 and in 6 ticks at the old 24.

### Measured

Flat ground, 128 Hz, autobhop, starting at 9.5 m/s, speeds in m/s. "Perfect"
means the view is put on the velocity heading before every tick. The old
controller column is the same input run for 70 and 700 ticks (one and ten
jumps' worth).

| Input | 1 jump | 5 jumps | 10 jumps | Old controller, 70 / 700 ticks |
|---|---|---|---|---|
| Strafe key held, view still | 9.53 | 9.53 | 9.53 | 13.44 / not measured |
| Perfect, one key the whole time | 11.44 | 17.13 | 22.29 | 17.67 / 48.08 |
| Perfect zigzag, 2 strafes a jump (100% sync) | 11.42 | 16.98 | 22.04 | not measured |

The 10-jump perfect value matches sqrt(9.5² + 700 × 0.762²) = 22.29 m/s to
float precision.

Gain against HUD sync, 2 strafes a jump. The desync comes from letting go of
the key a few ticks before each switch while the mouse keeps turning, the
most common real mistake:

| HUD sync | Jump 1 | Average per jump over 10 | After 10 jumps |
|---|---|---|---|
| 100% | +1.92 m/s | +1.25 m/s | 22.04 m/s |
| 79% | +1.55 m/s | +1.06 m/s | 20.11 m/s |
| 50% | +1.02 m/s | +0.75 m/s | 16.98 m/s |

The gain per jump in m/s shrinks as you speed up because the v² gain per jump
is fixed.

Surf, 8 m/s along a ramp holding the key into it for 1 s, in surf mode on
every tick:

| View | 55° ramp | 60° ramp |
|---|---|---|
| Straight along the ramp | 8.06 m/s, climbs 0.77 m | 8.06 m/s, climbs 0.85 m |
| 10° down the ramp | 12.26 m/s, drops 1.60 m | 13.06 m/s, drops 2.07 m |
| 20° down the ramp | 15.12 m/s, drops 3.87 m | 16.18 m/s, drops 4.73 m |

Holding into the ramp while looking along it holds your height, which Source
does too: after the ramp clip, what's left of the push beats gravity's
g sin θ dt every tick. You pick up speed by looking down the ramp and letting
gravity work.

### Strafe stats API

`MovementController.getStrafeStats()` returns `{ chain, current, last }`.
`chain` is the jump count of the current chain, 0 once you stand on the
ground for 3 ticks without jumping. `current` is the jump in progress and
`last` the last finished one, both `{ jump, takeoffSpeed, gain, sync,
strafes, maxSpeed, airTicks }` in m/s with sync from 0 to 100. A jump runs
from its takeoff tick to the first ground tick or the next takeoff, and
`gain` is the takeoff speed minus the previous takeoff's. Sync only measures
air ticks where the view yaw changed, so running under 128 fps doesn't read
as desync. A measured tick is in sync when a strafe key is held, the yaw
turned toward it and horizontal speed went up. Strafes count sideMove side
switches (A, D, A is 3). It's presentation only and not in
`MovementSnapshot`. The live speed stays `getDebugState().speed`.

### Tests

In `src/movement/__tests__/`:

- `AirStrafe`: the cap with the view still, per-tick gain equal to
  sqrt(v² + W²) - v, steady turns never beating it, desync gaining nothing,
  W only never passing the takeoff speed, and the 10-jump chain against the
  derivation.
- `SurfRamp`, `GroundContact`, `MapCvars` and `StrafeStats`, plus
  `airAccelerate` unit tests.

Two old tests were retuned because they depended on the uncapped air
control (commit `4434747` has the details).

### Known gaps

- `GameApp` applies mouse look once per rendered frame. Under 128 fps some
  ticks see no turn and the next one sees two ticks' worth, which costs real
  strafe gain. The HUD sync skips those ticks but the physics doesn't.
  Spreading each frame's look delta over its ticks would fix it.
- Walking up a slope leaves an upward vy on the flat ground at the top, so
  walking off that ledge pops you up (0.58 m after a 26° slope at full
  speed). This was already there.
  Zeroing it Source-style would also slow walking up slopes, so it needs its
  own tuning pass.
- Jumping off a surf ramp is still allowed on a fresh press. Source doesn't
  allow it at all.
- Bots and the server bot sim use the default cvars, not the map's.
- Autobhop can't be turned off per map because the settings toggle always
  wins. Autobhop off in combat modes needs a per-room cvar.
- Ticks replayed after a rollback update the strafe stats a second time.

## 5. Weapons and knives

Display names are our own. "AWP" is an Accuracy International trademark,
"Desert Eagle" is a Magnum Research trademark, and "Counter-Strike"/"CS2" are
Valve's. Internal ids (`awp`, `deagle`) can stay. Suggested UI names:
**"Longbow .338"** for the bolt-action sniper and **"Hand Cannon .50"** for the
heavy pistol.

### Sniper (AWP-style), phase 2

- Two scope zoom levels (FOV 40° and 10°), scope overlay, unscope on fire and
  re-scope after the bolt.
- One-shot kill to the body (115 damage, head 1.5×), limb damage lower once
  hitboxes exist.
- Inaccuracy model: standing ≈ 0, crouch lower, moving or in the air large. No
  scoped accuracy while moving over 34% of max speed, so jump shots are
  deliberately bad, like CS.
- Bolt cycle 1.46 s, which is the current `FIREARM_TIMINGS`. Reload is a
  separate animation.

### Heavy pistol (Deagle-style), phase 2

- First-shot accuracy when standing still, recovering over about 0.4 s. Recoil
  with a vertical kick and a random horizontal drift, and a view punch that
  decays.
- 63 body damage, 2× headshot (126, a one-tap).
- Fire interval 225 ms (current), 7-round magazine.

### Knives (phase 1 foundation, done here)

The verified CS2 knife list (Sep 2026) is 20 types. The Kukri (Kilowatt Case,
Feb 2024) is the newest. Sources:
[CSDB knife list, cross-checked with game files](https://csdb.gg/cs2-csgo-knife-tier-list/)
and [Tradeit case history](https://tradeit.gg/blog/all-knife-cases-in-cs2/).

| CS2 type | In-game name | Profile / handle |
|----------|--------------|------------------|
| Bayonet | Trench Bayonet | spear, fuller, cross guard, grip |
| Flip Knife | Flip Folder | drop point, bolster, scales |
| Gut Knife | Gut Hook | gut hook, grip |
| Karambit | Karambit | hawkbill, finger ring |
| M9 Bayonet | Field Bayonet | clip point, serrated spine, muzzle ring |
| Huntsman Knife | Hunting Knife | clip point, serrated spine |
| Butterfly Knife | Balisong | split handles, latch, pivot |
| Falchion Knife | Falchion Folder | cleaver belly |
| Shadow Daggers | Push Daggers | T-handle (dual) |
| Bowie Knife | Bowie | large clip point, wood |
| Navaja Knife | Navaja | slim drop point, wood |
| Stiletto Knife | Stiletto | needle |
| Talon Knife | Folding Hawkbill | hawkbill, scales |
| Ursus Knife | Heavy Folder | wide drop point |
| Classic Knife | Classic Fixed Blade | drop point, cross guard |
| Paracord Knife | Cord-Wrap Knife | tanto, cord wrap |
| Survival Knife | Survival Knife | serrated, cord wrap |
| Nomad Knife | Wanderer | drop point, scales |
| Skeleton Knife | Skeleton Blade | open frame handle |
| Kukri Knife | Kukri | recurve, wood |

![All 20 procedural knives](images/knife-gallery.png)

Implementation:

- `src/combat/knives.ts` is the catalog: shape parameters, draw and inspect
  timings, and the shared CS-style damage (primary 40, or 25 on a follow-up;
  secondary 65; backstab 90 and 180). `isBackstab()` uses the same rear cone as
  the existing "backstab ready" cue.
- `src/cosmetics/ProceduralKnife.ts` builds every model from code: extruded 2D
  blade profiles, guards, handles, rings, serrations and cord wraps, all under
  6k triangles. No external assets.
- `src/cosmetics/KnifeStyleSwap.ts` measures the authored knife inside the
  arms viewmodel, hides it, and mounts the procedural knife on the same
  animated `knife` node. That way every existing draw, idle, attack and inspect
  animation keeps working.
- The menu's **Knives** tab lists all 20 plus "Legacy Knife". The choice is
  saved in localStorage, and the default is the Karambit.

| Procedural karambit | Legacy imported knife |
|---|---|
| ![procedural](images/viewmodel-karambit.png) | ![legacy](images/viewmodel-legacy-knife.png) |

Next for knives (phase 2): per-type animation sets (butterfly flip draw, karambit
spin inspect, push daggers dual wield) built as original procedural keyframes;
server-side primary and secondary resolution using `knifeDamage` + `isBackstab`
(the server already has victim yaw); knife id in presence and join so remote
players show your knife; finishes (the existing `WearMaterial` shader).

## 6. Viewmodels, feedback, maps, UI, audio

- **Viewmodels:** keep the current rig for now. Build original arms (procedural
  or Blender, which isn't installed on this machine) to replace the imported
  ones (see section 7). Add sway, bob and landing dip per weapon (partly there
  in `ViewmodelRenderer`).
- **Hit feedback:** server-confirmed hitmarkers and damage numbers exist.
  Add a headshot ding, kill confirm, directional damage indicator, and blood or
  impact decals from the server-resolved endpoint.
- **Maps:** keep `surf_skyworld_x` (CC-BY) and the training maps. Add original
  bhop maps (block-out style, easy to author procedurally) and a small aim arena
  for AWP and Deagle duels.
- **UI:** loadout screen (primary, secondary, knife, gloves), a scoreboard on
  Tab (kills, deaths, ping, speed record), the existing killfeed, a net graph
  (ping, loss, interp delay; `getPresentationDelayMs` is exposed), and a speed
  and sync HUD for bhop.
- **Audio:** keep CC0 Freesound and BigSoundBank sources, add procedural Web
  Audio for knife hits and footsteps, and make gunshots positional.

## 7. IP and licensing

Rules for new work: no Valve or Counter-Strike assets (models, textures,
sounds, animations, maps) and nothing without a clear licence. Everything
added in phase 1 is original code-generated geometry.

Existing assets that need a licence review (not changed in this PR):

- `public/playermodels/*.glb` are "CTM_SAS | CS2 Agent Model" and "PHOENIX |
  CS2 Agent Model" from Sketchfab, labelled CC-BY. These are almost certainly
  extracted from CS2. A CC-BY label from an uploader doesn't grant rights to
  Valve's models. **Highest risk; recommend replacing.**
- `public/viewmodels/knife/*.glb` ("knife animated" by DJMaesen) and the
  Deagle and AWP rigs (1Matzh, Addison Ye) are Sketchfab CC-BY. Their
  provenance is unverified; they may be game rips. The procedural knives
  already remove the knife blade from the visible default.
- `surf_skyworld_x` (EVAI, CC-BY): confirm EVAI is the original map author and
  not a re-upload of a community CS map.

## 8. Reproducing the measurements

```bash
npm run bench:net                                    # ws server, 4 link profiles, 25 s each
npm run bench:net -- --only rtt60_jitter_loss --secs 30
VITE_SUPABASE_URL=... VITE_SUPABASE_KEY=... npm run bench:net -- --transport supabase --skew 150
VITE_SUPABASE_URL=... VITE_SUPABASE_KEY=... npx tsx tools/netbench/supabase-probe.ts prod
CHROME_PATH=/path/to/chrome node tools/netbench/tab-throttle.mjs
```

Results land in `tools/netbench/results/`. Baseline (`before-*`) files were
produced from `main` with the same bench code. The Supabase modes only ever use
`webstrafe_bench_*` channels, never a real lobby, but they do count towards the
project's message quota.

## 9. Phases

1. **This PR:** root-cause netcode fixes, bench, prediction foundation, knife
   data model and all 20 procedural knives with a selector.
2. **Authoritative server:** inputs, server movement, reconciliation wired
   end-to-end, Fly.io `sea` deploy (needs approval), air wishspeed cap + bhop
   cvars, net graph.
3. **Weapons:** sniper scope, inaccuracy, bolt; pistol recoil and accuracy;
   server-side knife primary, secondary and backstab; hitboxes.
4. **Content:** original arms and player models to replace the flagged assets,
   per-knife animations, bhop maps, scoreboard, loadout screen, audio pass.
