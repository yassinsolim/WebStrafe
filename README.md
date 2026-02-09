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

Open the local Vite URL printed in the terminal.

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
- `F`: inspect
- `LMB` / `RMB`: knife attacks
- `Esc`: unlock pointer / return to menu

## Project Structure

- `src/app/` - runtime orchestration and main game loop
- `src/movement/` - movement math + controller + movement tests
- `src/world/` - map loading, spawn resolution, BVH collision
- `src/ui/` - menu + HUD
- `src/cosmetics/` - viewmodel rendering + cosmetic animation/material systems
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

## Deployment Notes

Planning to host in a containerized setup is straightforward.  
For future Docker hosting, a simple static Vite build served via Nginx or Caddy is a good starting point:

1. `npm run build`
2. Serve `dist/` as static files
3. Ensure correct SPA/static routing and asset cache headers
