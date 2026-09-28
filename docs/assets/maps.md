# Maps

WebStrafe v2 ships six original maps plus the generated practice range:

| id | name | mode | modes / difficulty | cvars |
|----|------|------|--------------------|-------|
| `surf_prismline` | Prismline | surf, 4 stages | surf / intermediate | `sv_airaccelerate` 150 |
| `surf_lumen` | Lumen | surf, 1 stage, 6 ramps | surf / beginner | `sv_airaccelerate` 150 |
| `surf_cascade` | Cascade | surf, 6 stages | surf / intermediate | `sv_airaccelerate` 150 |
| `surf_vanta` | Vanta | surf, 4 stages with transfers, plus a combat deck | surf, combat / advanced | `sv_airaccelerate` 150 |
| `bhop_emberdrift` | Emberdrift | bhop, 33 jumps | surf / intermediate | `sv_airaccelerate` 1000 |
| `aim_ochrecut` | Ochre Cut | AWP and Deagle duels, bots | combat | none |
| `movement_test_scene` | Movement Test Scene | combat practice range | surf, combat | none |

All maps and textures are original. The layouts were designed for WebStrafe,
the geometry is built by the scripts in `tools/blender/maps/` (and
`tools/generate-sample-assets.ts` for the practice range), and every texture is
generated procedurally by those scripts with numpy. No Valve or Counter-Strike
assets, no community map layouts, no downloaded models or textures.

Default map: Prismline outside combat, Ochre Cut with `VITE_ENABLE_COMBAT=true`.

## Rebuilding

```bash
# one map (about 3 to 4 minutes, most of it the Cycles bake on the M5 GPU)
blender -b --factory-startup --python-exit-code 1 -P tools/blender/maps/build_surf_prismline.py
blender -b --factory-startup --python-exit-code 1 -P tools/blender/maps/build_surf_lumen.py
blender -b --factory-startup --python-exit-code 1 -P tools/blender/maps/build_surf_cascade.py
blender -b --factory-startup --python-exit-code 1 -P tools/blender/maps/build_surf_vanta.py
blender -b --factory-startup --python-exit-code 1 -P tools/blender/maps/build_bhop_emberdrift.py
blender -b --factory-startup --python-exit-code 1 -P tools/blender/maps/build_aim_ochrecut.py

# fast layout pass: flat lightmap, no packaging
blender -b --factory-startup --python-exit-code 1 -P tools/blender/maps/build_surf_prismline.py -- --no-bake --no-package

# repackage from .blender-tmp without rebuilding
npx tsx tools/blender/maps/package_map.ts surf_prismline
```

Flags after `--`: `--no-bake`, `--no-render`, `--no-package`, `--samples N`
(bake samples, default 384), `--lightmap N` (atlas size, default 2048).

A build writes scratch files to `.blender-tmp/maps/<id>/` and then
`package_map.ts` produces:

- `public/maps/<id>/scene.glb`: render meshes through `tools/assets/optimize-glb.ts`
  (meshopt, quantized, WebP textures at most 1024 px)
- `public/maps/<id>/collision.glb`: solid gameplay geometry only, one merged
  mesh, positions and indices, no materials, no meshopt (the node server parses it)
- `public/maps/<id>/lightmap.ktx2`: 2048 px baked light atlas (ETC1S KTX2, srgb rgb plus linear alpha)
- `public/maps/<id>/thumbnail.webp`: 480x270 menu card image (`thumbnailPath` in the manifest)
- `public/maps/<id>/meta.json`: spawns, triggers, cvars, environment
- `tools/blender/maps/layouts/<id>.json`: platform and ramp data the tests check against
- `docs/screenshots/maps/<id>_overview.png` and `<id>_eye.png` (plus `<id>_arena.png`
  for a map whose build renders an `arena` view)

## How the pipeline works

`tools/blender/maps/maplib.py` is shared by every build script.
`tools/blender/maps/surflib.py` holds what the newer surf maps (Lumen, Cascade,
Vanta) share on top of it: stage frames, prism ramps and forks, gated platform
walls, trigger volumes and the layout file. Prismline keeps its own copies.

- **Parts.** Render geometry is grouped by chunk (a course section, a stage, a
  lane) and material, one object each. That keeps draw calls low and keeps each
  mesh small enough that 14 bit meshopt quantization stays in the millimetre range.
- **UVs.** UV0 projects world positions onto each face, so textures tile in
  metres and continue across neighbouring blocks. Surf ramps stretch v from the
  foot to the ridge of each face so the ridge band always sits on the ridge.
  UV1 is a lightmap atlas: smart project, islands scaled by a per face texel
  weight (walkable tops 1.0, far cliffs 0.0015, faces under lava almost 0), then packed.
- **Lightmap.** Cycles on the GPU bakes three passes into one atlas, all with no
  albedo: the full diffuse light (direct + indirect, 384 samples), the sun's
  direct light alone (sky and emission switched off) and a shadow pass for the
  sun's visibility. The shipped `lightmap.ktx2` holds full minus sun direct in
  rgb (sky light, emissive light and every bounce, the sun's included) and the
  sun's visibility in alpha. OpenImageDenoise cleans the rgb through the
  compositor, chart borders are dilated and rgb is sRGB encoded as
  `light / scale`. The bake sky is scaled by `bake_sky_scale` (default 0.55)
  so the sun reads about 3:1 over the sky; it used to light as strongly as
  the sun, which washed every shadow out. A plain full bake is still written
  (`lightmap_full.png`, not shipped) for the preview renders.
- **Runtime.** `src/world/MapEnvironment.ts` loads the lightmaps listed in
  `meta.environment.lightmaps` (`texture.channel = 1`, GLTFLoader names
  TEXCOORD_1 `uv1`) through ImageBitmap with `premultiplyAlpha: 'none'`, so the
  alpha channel never eats the rgb. With `lightmapMode: "indirect"` every mesh
  with `uv1` gets a lit material (`src/render/worldMaterials.ts`): the live sun
  is multiplied by the baked visibility, so it keeps the baked soft shadows but
  gains normal maps (generated from the albedo on the GPU), specular and live
  player shadows; the baked rgb replaces the sky's diffuse light, and sky
  reflections are occluded where the bake saw less sky. Low uses a Lambert
  surface, medium and high a standard one. `lightMapIntensity` is
  `pi * scale` (Cycles bakes irradiance / pi) and `indirectIntensity` scales
  the baked light at runtime. Normals are rebuilt from the triangle winding at
  load, because some packed faces (the floor slabs) carry normals pointing
  against their winding; the old unlit materials never read normals. Maps
  without `lightmapMode` keep the v2 path, `MeshBasicMaterial(map, color,
  lightMap)`. Meshes without `uv1` (emissive trims, lava) keep
  MeshStandardMaterial. Players and weapons are lit by the same sun and by a
  PMREM capture of the sky dome (`envIntensity`).
- **Sky.** A shader dome (gradient, sun disc and glow, drifting self shadowed
  fbm clouds) in linear hdr. Its colour keys are the meta's display colours run
  back through the map's grade (`src/render/grade.ts`), so after tone mapping
  the horizon matches the fog colour exactly and the sky shows as authored. The
  sun disc is far above 1 so bloom turns it into glare.
- **Grade.** `meta.environment.grade` (exposure, contrast, saturation,
  temperature, tint, vignette, bloom, bloomThreshold) drives the composite pass
  in `src/render/RenderPipeline.ts`; missing fields use the house look.
- **Previews.** The docs renders swap every material for an emission shader
  that computes albedo x baked light, then the three.js ACES filmic curve with
  the map exposure, then linear fog in display space. They show what the game
  draws, minus the clouds.

## meta.json additions

```jsonc
{
  "spawns": [{ "position": [x, y, z], "yawDeg": 0, "side": "a" }],
  "triggers": [
    { "id": "start", "type": "start", "min": [..], "max": [..], "target": { "position": [..], "yawDeg": 0 } },
    { "id": "cp1", "type": "checkpoint", "stage": 1, "min": [..], "max": [..], "target": { .. } },
    { "id": "lava", "type": "teleport", "min": [..], "max": [..] },
    { "id": "finish", "type": "finish", "min": [..], "max": [..] }
  ],
  "cvars": { "sv_airaccelerate": 1000 },
  "modes": ["surf"],
  "difficulty": "intermediate",
  "parTimeMs": 112200,
  "environment": {
    "sky": { "zenith": "#28305f", "horizon": "#f2a36e", "ground": "#7a3326", "exponent": 0.55,
             "sunSizeDeg": 2.2, "sunGlow": 0.45, "sunHaze": 0.3,
             "clouds": { "color": "#ffb48a", "shadow": "#6a4a78", "coverage": 0.46, "scale": 0.9, "speed": 0.004, "height": 0.35 } },
    "sun": { "direction": [x, y, z], "color": "#ffc893", "intensity": 5.4 },
    "hemi": { "sky": "#9a9ed8", "ground": "#c0583a", "intensity": 2.4 },
    "fog": { "color": "#e9946a", "near": 55, "far": 460 },
    "exposure": 1.12,
    "lightmaps": [{ "path": "/maps/bhop_emberdrift/lightmap.ktx2" }],
    "lightMapIntensity": 11.0,
    "lightmapMode": "indirect",
    "indirectIntensity": 1.0,
    "envIntensity": 1.0,
    "grade": { "exposure": 1.05, "contrast": 1.1, "saturation": 1.06, "vignette": 0.26, "bloom": 0.09 }
  }
}
```

- Trigger volumes are axis aligned boxes in three.js world space, tested against
  the feet once per 128 Hz tick after `movement.tick` (`src/world/MapTriggers.ts`).
  They fire on entry. `start` holds the run timer at zero while you stand in it
  and resets the checkpoint; `checkpoint` stores its target (or the entry point);
  `teleport` sends you to its target or the last checkpoint with velocity
  zeroed; `finish` completes the run through the normal run-complete flow.
  Maps without triggers keep the old `goalPad` behaviour.
- `lightmaps[].match` (optional) assigns a lightmap to meshes whose name
  contains the string; the entry without `match` is the default. All three
  maps use one atlas.
- `spawns[0]` is where runs start. Combat respawns pick a spawn away from living
  enemies (`src/world/SpawnPoints.ts`). When spawns have a `side`, bots gather
  at the first spawn on the other side (node server and Supabase host).
- `cvars` is only data here; the movement workstream applies it.
- `modes` (`surf`, `combat` or both), `difficulty` (`beginner`, `intermediate`,
  `advanced`) and `parTimeMs` are optional metadata; the manifest repeats
  `modes` and `difficulty` for the menu. `parTimeMs` is the time the fastest
  headless full-run rider (`src/world/__tests__/surfRiders.ts`: walks out of
  each gate, holds a line into every face with keyboard input, never
  bhops or strafes with the mouse) needs from leaving the start zone to the
  finish, rounded to 100 ms. A good human run is well under it.

## Prismline (`surf_prismline`)

Clean sci-fi yard in a clear midday sky: concrete platforms with hazard striped
lips, colour coded prism ramps on steel pylons, all spiralling down around a
white signal tower. Stage colours: teal, violet, amber, rose.

The four stages run clockwise around a square. Each stage starts on a walled
platform with a 12 m gate; you drop through it onto the first ramp 4.5 m below.
Ramps in a stage are collinear, 3.5 to 4 m apart, each ridge 8.5 to 9 m under
the previous one, and each follow-up ramp is wider than the one before so a
rider low on a face is still above the next face. The last ramp ends 2 m before
a 40 m walled landing platform, which is the next stage's start.

| stage | ramp | angle | length | face height |
|------:|-----:|------:|-------:|------------:|
| 1 | 1 | 56 | 92 m | 14 m |
| 1 | 2 | 57 | 80 m | 17 m |
| 2 | 1 | 58 | 72 m | 14 m |
| 2 | 2 | 58 | 64 m | 16.5 m |
| 2 | 3 | 59 | 60 m | 19 m |
| 3 | 1 | 59 | 112 m (descends 8 m) | 16 m |
| 3 | 2 | 60 | 56 m | 19 m |
| 4 | 1 | 60 | 64 m | 15 m |
| 4 | 2 | 61 | 62 m | 17.5 m |
| 4 | 3 | 62 | 92 m | 20 m |

Every ramp face is one planar quad (two triangles, no vertex inside it) in both
the render mesh and the collision mesh; the tests check both. Triggers: the
start platform, a checkpoint on each stage platform, a teleport volume under
each stage back to that stage's start (it stops short of the next stage so it
can never catch a rider on course), the finish pad 164 m below the start, and
a void catch.

## Lumen (`surf_lumen`)

Beginner surf on a calm, bright morning: pearl limestone plazas with gold trim,
six wide sea-glass ramps whose pastel tint shifts from aqua to peach along the
line, round lantern arches standing in a turquoise lagoon over every gap, sand
islets and a striped lighthouse by the finish.

One stage in a straight line. You drop through the arched gate onto the first
ramp, ride all six and land on a walled 48 m finish plaza 101 m below the start
(its end wall is 11 m tall because the line arrives fast). The faces are wide
(13.4 to 15.2 m from ridge to foot) and carry faint depth lines a quarter, half
and three quarters of the way down. Every follow-up ramp is wider than the one
before and 9 to 10 m lower after a 5.5 to 6 m gap, and most of them descend
along their length, so the line keeps flowing.

| ramp | angle | length | face height | gap after previous |
|-----:|------:|-------:|------------:|-------------------:|
| 1 | 50 | 88 m | 16 m | |
| 2 | 51 | 84 m (descends 4 m) | 17.5 m | 5.5 m, 9 m drop |
| 3 | 52 | 80 m (descends 4 m) | 18.5 m | 5.5 m, 9 m drop |
| 4 | 53 | 80 m (descends 5 m) | 19.5 m | 6 m, 9.5 m drop |
| 5 | 54 | 78 m (descends 5 m) | 20.5 m | 6 m, 9.5 m drop |
| 6 | 56 | 92 m (descends 6 m) | 22.5 m | 6 m, 10 m drop |

Triggers: start plaza, finish plaza (the volume reaches 14 m up), one catch
volume under each ramp stepping down with the line (each ends a metre before
the next ramp), all sending you back to the start, and a void catch. Par time
26.9 s.

## Cascade (`surf_cascade`)

Six short stages stepping down a canyon of waterfalls at dusk: flagstone
ledges walled in red cliff stone with lanterns, carved granite ramps whose
colour cools from ochre through rose and plum to teal slate as you drop, water
pouring off the back of every ledge and off the canyon walls into a misty
basin. The low sun sits in the west-north-west; the canyon wall on its side is
kept low so it still reaches the ramps.

Each stage is a chain of two or three ramps ending on a walled 40 m ledge,
which is the next stage's start and a checkpoint. The stages zigzag (right,
left, right, left, right) so the canyon runs diagonally and no stage sits over
another. The finish ledge is 234.5 m below the start.

| stage | ramp | angle | length | face height | gap after previous |
|------:|-----:|------:|-------:|------------:|-------------------:|
| 1 | 1 | 55 | 72 m | 14 m | |
| 1 | 2 | 56 | 64 m | 16.5 m | 4 m, 8.5 m drop |
| 2 | 1 | 56 | 68 m | 14.5 m | |
| 2 | 2 | 57 | 62 m | 17 m | 4 m, 8.5 m drop |
| 3 | 1 | 57 | 58 m | 14 m | |
| 3 | 2 | 57 | 56 m | 16.5 m | 4 m, 8.5 m drop |
| 3 | 3 | 58 | 54 m | 18.5 m | 4 m, 9 m drop |
| 4 | 1 | 58 | 76 m (descends 5 m) | 15 m | |
| 4 | 2 | 58 | 60 m | 17.5 m | 4.5 m, 9 m drop |
| 5 | 1 | 59 | 66 m | 15 m | |
| 5 | 2 | 59 | 62 m | 17.5 m | 4.5 m, 9 m drop |
| 6 | 1 | 59 | 60 m | 15 m | |
| 6 | 2 | 60 | 58 m | 17.5 m | 4.5 m, 9 m drop |
| 6 | 3 | 60 | 72 m (descends 4 m) | 19.5 m | 4.5 m, 9.5 m drop |

Triggers: start, checkpoints `stage2` to `stage6` on the ledges, a teleport
under each stage back to its start (`fall1` to `fall6`), the finish ledge and a
void catch. Par time 88.1 s (most of it the rider walking across five ledges).

## Vanta (`surf_vanta`)

Advanced surf at night high above a city of lights, plus a combat deck at
spawn. Graphite ramps edged in neon (cyan, magenta, lime and amber by stage)
float on glowing lift pods, the decks are dark steel with neon trim, storm
clouds drift past a big pale moon and lit towers rise out of the city below.

Surf: four stages turning right, left, left, 58 to 64 degrees, 6 to 7 m gaps
and 9 to 10 m drops. Stages two and three each have a transfer: the line splits
into two mirrored ramps 9 to 9.5 m either side of it that form a valley under a
neon frame, so a rider on the right face of the ramp before lands on the left
face of the right half, then comes back onto the right face of the ramp after
it (mirrored on the left). The finish deck is 225 m below the start.

| stage | ramp | angle | length | face height | gap after previous |
|------:|-----:|------:|-------:|------------:|-------------------:|
| 1 | 1 | 58 | 90 m | 16 m | |
| 1 | 2 | 59 | 80 m | 18 m | 6 m, 9.5 m drop |
| 1 | 3 | 60 | 72 m (descends 4 m) | 19.5 m | 6.5 m, 9.5 m drop |
| 2 | 1 | 60 | 70 m | 16 m | |
| 2 | 2 (fork) | 61 | 62 m | 18 m | 6 m, 9 m drop |
| 2 | 3 | 61 | 70 m (descends 4 m) | 19.5 m | 6 m, 9.5 m drop |
| 3 | 1 | 62 | 76 m | 16.5 m | |
| 3 | 2 | 62 | 60 m | 18.5 m | 6.5 m, 9.5 m drop |
| 3 | 3 (fork) | 63 | 58 m | 19.5 m | 6 m, 9 m drop |
| 3 | 4 | 63 | 64 m | 20.5 m | 6.5 m, 9.5 m drop |
| 4 | 1 | 63 | 72 m | 17 m | |
| 4 | 2 | 64 | 66 m (descends 4 m) | 19 m | 7 m, 10 m drop |
| 4 | 3 | 64 | 80 m (descends 6 m) | 21 m | 7 m, 10 m drop |

Combat: the start pad's back wall has a 12 m doorway onto a walled, flat
64 x 48 m deck. Cover is point symmetric about the deck centre: a 7 m centre
block, L shaped walls, 5 m pillars, low walls, crate stacks and a long side
block. Four spawns per side (side a by the pad, side b across the deck) face
the other side; `spawns[0]` is the run start on the pad (side a), so bots
gather at side b. Team colours: cyan for side a, pink for side b. Surf triggers
cover only the pad, the stage platforms and the space under the stages, so
fights on the deck never touch the run.

Triggers: start pad, checkpoints `stage2` to `stage4`, `fall1` to `fall4`, the
finish deck and a void catch. Par time 72.8 s.

## Emberdrift (`bhop_emberdrift`)

Sandstone flagstone caps with brass trim on octagonal basalt pillars, rising out
of a lava caldera at golden hour. Checkpoints glow teal, the finish is gold,
lava glows orange and lights the undersides of the course in the bake.

33 jumps in five sections, all tuned to the movement code (gravity 19, jump
5.4 m/s, a flat jump is 0.57 s and 5.4 m at 9.5 m/s):

1. warm-up: flat 3 m blocks, 2.2 to 2.8 m gaps, a small step up and down
2. drops: 1.2 to 1.6 m drops with 3.6 to 3.8 m gaps and a 0.4 m rise
3. a 90 degree right turn over four jumps (22.5 degrees of air strafe each)
4. long jumps: 4.6 m with a 1.4 m drop, then 5.0 m (about 11 to 12 m/s)
5. a 90 degree left turn in two 45 degree jumps, a zigzag, then the finish

Checkpoints are 5.6 to 6 m rest pads every six jumps under ruin arches with a
teal beacon. Falling triggers a teleport volume 3.5 m under the section (or the
lava catch) and sends you to the last checkpoint. The start plaza is walled on
three sides with a gate arch.

## Ochre Cut (`aim_ochrecut`)

AWP and Deagle duels in the floor of a sandstone quarry: 124 m x 52 m, point
symmetric (side B is side A rotated 180 degrees), terraced cliff walls, a crane
on the skyline.

- Mid lane (14 m wide): a clear 112 m line nest to nest for the AWP, low walls,
  blocks and crates for pushing mid, a shield wall in front of the mid spawns.
- Separators: rows of shipping containers (teal on side A, orange on side B)
  with gaps every 9 to 15 m to cross and angle between lanes.
- Side lanes (14 m wide): crates, cut stone and low walls every 8 to 12 m for
  10 to 30 m Deagle fights, pallets to climb onto crate stacks.
- Sniper nests 4.5 m up at both ends with a parapet slot and a sun canopy,
  reached by two stair ramps at 29 degrees.
- Six spawns per side facing the enemy half. Bots gather on side B.

The sun comes from due east so each team has one lane edge in shadow.

## Budgets

Numbers from the last build (`npx vitest run src/world/__tests__/BuiltMaps.test.ts`
enforces at most 150 draw calls, 250k triangles and 8 MB per map).

| map | triangles | draw calls | collision tris | scene.glb | lightmap | collision | thumbnail | total |
|-----|----------:|-----------:|---------------:|----------:|---------:|----------:|----------:|------:|
| surf_prismline | 11,576 | 67 | 476 | 601 KB | 192 KB | 7 KB | 11 KB | 0.79 MB |
| surf_lumen | 11,480 | 49 | 192 | 490 KB | 183 KB | 3 KB | 11 KB | 0.67 MB |
| surf_cascade | 19,480 | 61 | 676 | 1127 KB | 318 KB | 10 KB | 11 KB | 1.43 MB |
| surf_vanta | 9,792 | 58 | 924 | 887 KB | 165 KB | 13 KB | 13 KB | 1.05 MB |
| bhop_emberdrift | 27,068 | 53 | 1,624 | 1157 KB | 491 KB | 22 KB | 20 KB | 1.65 MB |
| aim_ochrecut | 10,272 | 39 | 1,412 | 524 KB | 243 KB | 20 KB | 21 KB | 0.79 MB |

The sky is a shader, so there is no sky download. Lightmap texel density on
walkable tops: 18 texels per metre on Emberdrift, 12 on Ochre Cut, 11 on Lumen,
10 on Prismline, 9 on Vanta, 7.5 on Cascade (ramp faces 3.5 to 5.3, they are
planar and evenly lit). Bakes take 130 to 210 s each at 384 samples on the M5
GPU when it is free; with other Blender jobs running they took 6 to 20 minutes.

Low suns and night skies leave the faces turned away from the key light nearly
black in the bake, which you can't surf, so Cascade and Vanta add a soft fill
sun from roughly the opposite side (`surflib.add_fill_light`, bake only; the
game draws lit meshes from the lightmap alone).

## Retired

- `surf_skyworld_x` (116 MB, labelled CC-BY by an uploader who may not be the
  author): removed from `public/maps`, the manifest and the credits. Prismline
  replaces it as the default surf map.
- `training_straight` and `training_switchback`: placeholder blockouts, removed
  from `tools/generate-sample-assets.ts` and the manifest. Emberdrift and
  Prismline cover what they were for. Some tool scripts still join
  `training_straight` as a plain lobby name; the server accepts any id and those
  lobbies simply have no bots.
- `movement_test_scene` stays: it is generated in code and used as the combat
  practice range and by the server tests. Its menu source line now reads
  "Original WebStrafe practice range".

## Verification

- `npx vitest run src/world/__tests__/BuiltMaps.test.ts`: meta, grounded
  spawns and trigger targets, trigger safety (no teleport volume over a platform,
  a jump arc, a ramp face or a stage platform), planar ramp faces in both meshes,
  budgets, plain collision, cvars, bhop jump reachability, and headless runs with
  the real MovementController: spawn and fall to the ground on every map, the
  first five bhop jumps, a surf ride that stays in surf mode and gains speed,
  every surf stage of every surf map ridden onto its landing platform from both
  faces at 12, 18 and 26 m/s (through the forks on Vanta), full runs on Lumen,
  Cascade and Vanta from the spawn through every checkpoint to the finish with
  the time checked against `parTimeMs`, the Vanta deck (flat, mostly open,
  four grounded spawns per side, walkable from the run spawn), walking up the
  nest stairs, the AWP line, the spawn shield, and `modes` on every manifest map.
- `npx vitest run server/mapCollision.test.ts`: the node server loads each map's
  collision and meta, seats every spawn, and stages arena bots on side B.

## Known issues

- Surf needs the movement fix in commit "fix(movement): clip surf velocity only
  against planes you move into". Without it the capsule rolling off a ramp's
  end edge loses about half its forward speed and many riders fall short of the
  next ramp (20 of 40 simulated stage runs fail, 0 of 40 with the fix).
- The previews do not include the drifting clouds of the in-game sky. The eye
  renders use the game's default field of view (100 degrees vertical).
- Sprinting up one Ochre Cut nest stair and straight across onto the other gives
  a short hop at the far edge. Walking down from the nest is clean.
- These maps were not checked in a browser: the Cursor browser could not open a
  tab during this work, so the in-game look (exposure, lightmap brightness,
  clouds) still needs a live screenshot pass. Sky, fog, exposure and light
  values live in meta.json and can be tuned without a rebuild.
- Lumen, Cascade and Vanta were built and checked the same way (Blender
  previews and headless riders), not yet in a browser. Vanta's night look
  depends most on that pass.
- `parTimeMs` comes from a bot that only walks on platforms and holds a line
  with the strafe key, so it is a relaxed reference, not a target time.
