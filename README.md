# WebStrafe

WebStrafe is a browser-based Three.js surf sandbox inspired by classic CS:GO/CS2 bhop + surf servers.  
The focus is movement feel: bunnyhop timing, air-strafe speed gain, and surf ramp flow.

## Features

- Source-style kinematic movement controller
- Fixed-timestep simulation at `128 Hz`
- Surf/ground/air mode handling with ramp clipping + slide move
- Map manifest system with BVH collision against static triangle meshes
- First-person viewmodel pipeline (separate render scene/camera)
- Knife/glove loadout presets with animation ranges
- Run timer + finish detection to lowest platform
- Online leaderboard submission by player name
- Multiplayer presence with remote player models (T/CT by loadout preset)
- Debug HUD for movement, slope, collision and surf state

## Run Locally

### Prerequisites

- Node.js 20+
- npm

### Dev

```bash
npm install
npm run dev
```

`npm run dev` starts both:
- Vite client (`http://localhost:5173`)
- Multiplayer/leaderboard server (`http://localhost:8787`)

For the one-bot combat range, use `npm run dev:combat`. This managed process
starts the bot backend first, then Vite on `http://127.0.0.1:5174`, verifies
the HTTP and WebSocket proxies, monitors both children, and stops both together.
With it running, `npm run verify:combat-runtime` performs a 90-second proxy
health check.

### Native combat browser verification

Run the complete player-facing firearm check with:

```bash
npm run verify:combat-browser
```

The command owns and cleans up a fixed loopback bot backend (`8787`), Vite
(`5174`), and Chrome CDP session (`9223`). It uses a fresh browser profile,
1600×900 DPR 1, and only native CDP mouse press/release, held key, wheel, Escape,
and menu-click input. It does not call game objects or inject gameplay/network
events. Read-only CDP observations cover real WebSocket outcomes, DOM/a11y state,
screenshots, application console output, and `WebAudio` graph events plus
`WebAudio.getRealtimeData` after the Play gesture. The verifier installs no page
preload script, binding, constructor replacement, or prototype patch.

Success writes `results.json` plus representative PNGs under the system
temporary directory and prints that path in one machine-readable `RESULT` line.
Failures are bounded, exit nonzero, retain the same concise evidence, and stop
owned children. Set `CHROME_PATH` when Chrome/Chromium is not in a standard
location; `COMBAT_BROWSER_TIMEOUT_MS`, `COMBAT_BROWSER_HEADED=1`, and
`COMBAT_BROWSER_OUTPUT=.artifacts/combat-browser` are optional.

### Test + Build

```bash
npm run test
npm run build
```

## Controls

- `W/A/S/D`: move
- `Mouse`: look
- `Space`: jump
- `R`: reset to spawn
- Run timer resets on `R`
- `Y`: inspect
- `LMB` / `RMB`: knife attacks
- `Esc`: unlock pointer / return to menu

## Project Structure

- `src/app/` - runtime orchestration and main game loop
- `src/movement/` - movement math + controller + movement tests
- `src/world/` - map loading, spawn resolution, BVH collision
- `src/ui/` - menu + HUD
- `src/cosmetics/` - viewmodel rendering + cosmetic animation/material systems
- `src/network/` - leaderboard API + multiplayer socket client
- `src/multiplayer/` - remote player model rendering
- `server/` - secure leaderboard + websocket multiplayer backend
- `tools/` - offline conversion/generation scripts

## Map & Asset Notes

- Map/knife metadata lives in:
  - `public/maps/manifest.json`
  - `public/cosmetics/manifest.json`
- Conversion pipeline docs:
  - `tools/README.md`

## Attribution

- `surf_skyworld_x` by EVAI (Creative Commons Attribution)
- Knife animations by DJMaesen (Creative Commons Attribution)
- `CTM_SAS | CS2 Agent Model` by Alex (Creative Commons Attribution)
- `PHOENIX | CS2 Agent Model` by Alex (Creative Commons Attribution)
- `Desert Eagle | First Person Animations` by 1Matzh — https://sketchfab.com/3d-models/desert-eagle-first-person-animations-09a213d8510a42d1b747135e85712eff (Creative Commons Attribution) — the production GLB preserves the authored textured two-hand rig, magazines, and reload clip
- `AWP with Anims` by Addison Ye — https://sketchfab.com/3d-models/awp-with-anims-d45669ad333d4885a854fcf899628a39 (Creative Commons Attribution) — the production GLB preserves the authored textured two-hand rig, magazine, and reload clip
- Knife swing sound effects by Joseph SARDIN from BigSoundBank (`Sword through the air 2`, `Sword that cuts 3`, plus two additional swipe variants)
- Deagle/AWP shots and reloads use the CC0 Freesound recordings documented in `public/audio/README.md`; hit confirmations use project-owned procedural Web Audio. Valve/CS2 proprietary firearm audio is not bundled.

## Deployment Notes

Planning to host in a containerized setup is straightforward.  
For future Docker hosting, a simple static Vite build served via Nginx or Caddy is a good starting point:

1. `npm run build`
2. Serve `dist/` as static files
3. Ensure correct SPA/static routing and asset cache headers
