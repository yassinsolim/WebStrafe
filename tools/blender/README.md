# Blender asset scripts

Every 3D asset added in v2 is built by a Python script in this folder and can be
rebuilt headless. Nothing here imports third-party models.

```bash
# blender 5.2 LTS (brew install --cask blender)
blender -b --factory-startup --python-exit-code 1 -P tools/blender/<area>/<script>.py -- <args>
# then shrink for the web (meshopt + webp textures, names kept)
npx tsx tools/assets/optimize-glb.ts in.glb public/<path>/out.glb --texture-size 1024
```

`common.py` has the shared helpers (scene reset, PBR materials, socket empties,
GLB export, preview renders). Each area keeps its own helpers next to its
scripts (`arms/`, `weapons/`, `maps/`) so work in one area never edits another.

Scratch output goes in `.blender-tmp/` (git-ignored). Only the optimized GLBs
under `public/` and the preview renders under `docs/screenshots/` are committed.

## Axes and units

- Metres, real-world scale.
- Blender is Z-up. The glTF exporter converts to three.js Y-up:
  Blender `+X right, +Y forward, +Z up` becomes three.js `+X right, -Z forward, +Y up`.
  Model weapons with the barrel along Blender `+Y` so it points down the camera's
  `-Z` in game.
- Moving parts are separate objects whose origin sits on the pivot, with
  rest transforms at identity rotation where possible.
- Sockets are empties named `socket_*`. Their location is the contract; their
  rotation follows the weapon frame (identity = forward along the barrel, up
  along the top of the weapon) unless noted, e.g. `socket_grip_r` tilts with the
  grip rake so its local up axis runs along the grip.

## First-person arms (`public/viewmodels/v2/arms.glb`)

One rig for every weapon and knife. Armature object `ArmsRig`, both arms in one
file, bone suffix `_l` / `_r`:

| bone | head | tail |
|------|------|------|
| `upperarm_s` | shoulder joint | elbow |
| `forearm_s` | elbow | wrist |
| `forearm_twist_s` (child of forearm) | about 7 cm before the wrist | wrist |
| `hand_s` | wrist joint | middle-finger knuckle |
| `thumb_01_s`..`thumb_03_s` | thumb base (metacarpal) .. tip | |
| `index_01_s`..`index_03_s`, `middle_*`, `ring_*`, `pinky_*` | knuckle → middle joint → last joint → tip | |

- Rest pose: arms straight forward along Blender `+Y`, palms down, fingers
  straight or slightly relaxed, thumbs resting beside the index finger. The
  runtime derives curl axes from the rest pose, so bone roll is free.
- Skin weights: at most 4 influences, normalized, smooth blends at every joint.
  The distal forearm blends from `forearm_s` into `forearm_twist_s` so wrist
  roll twists the forearm instead of pinching the wrist.
- The watch is rigid: an empty `watch` parented to bone `forearm_twist_l`, local
  `+Z` out of the dial, local `+Y` towards 12 o'clock (12 faces the little-finger
  side, the crown at 3 faces the hand). Child meshes `watch_case`, `watch_bezel`,
  `watch_crystal`, `watch_dial`, `watch_strap`, `watch_crown`, plus
  `watch_hand_hour`, `watch_hand_minute`, `watch_hand_second` with origins on the
  dial centre, lying flat and pointing at 12 at rest; the runtime spins them
  about local Z to show the real time. `watch_dial` UVs map the dial disk onto
  the full 0..1 square and `watch_bezel` UVs run u = angle clockwise from 12,
  v = radius, so the runtime can paint the dial and bezel with a canvas texture.

## Weapons (`public/viewmodels/v2/<id>.glb`)

Barrel along Blender `+Y`, top of the weapon `+Z`. Required names:

| name | deagle | awp | notes |
|------|--------|-----|-------|
| `socket_grip_r` | yes | yes | grip centreline at middle-finger height, local up along the grip rake |
| `socket_grip_l` | yes | yes | support palm contact: left grip panel (pistol), under the forend (rifle) |
| `socket_trigger` | yes | yes | trigger face |
| `socket_muzzle` | yes | yes | muzzle exit, forward = barrel |
| `socket_eject` | yes | yes | ejection port |
| `socket_mag_bottom` | yes | yes | child of `mag`, baseplate centre |
| `socket_slide_rear` | yes | | child of `slide`, rear serrations |
| `socket_bolt_knob` | | yes | child of `bolt`, centre of the bolt knob |
| `socket_scope_eye` | | yes | rear lens centre of the scope |
| `slide` | yes | | translates back along -Y |
| `hammer` | yes | | rotates about X at its pivot |
| `bolt` | | yes | origin on the bore axis; rotates about Y to lift, then slides back along -Y |
| `mag` | yes | yes | origin at the top of the magazine, drops along the magazine axis |
| `trigger` | yes | yes | rotates about X at its pivot |
