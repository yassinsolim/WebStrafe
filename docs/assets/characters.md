# Armored characters

Third-person player models: a real human body under four swappable armor sets
(Strafe, Anvil, Vector, Quill), five slots each (helmet, arms, chest, legs,
class item). Any mix of pieces merges into one skinned mesh per LOD with one
material, recoloured per player from the look (`src/characters/look.ts`).

## Build

```sh
sh tools/characters/build-armor.sh        # 4096 px atlas, ~5 min idle machine
```

Writes `public/characters/armor.glb`, `armor_normal.webp` and `armor_orm.webp`.
Needs Blender 5.x with the MPFB2 extension installed and enabled (the build runs
without `--factory-startup` so the extension loads). Rebuild `rig.json` with
`npx tsx tools/characters/export-rig.ts` only when `src/characters/skeleton.ts`
changes.

## Pipeline (`tools/blender/characters`)

1. `mpfb_body.py`: an MPFB2 human (MakeHuman CC0 assets) with the game_engine
   rig. The game skeleton uses its torso, neck and leg joints
   (`mpfb_joints.json`) and its 15 finger bones per hand (`mpfb_fingers.json`,
   `FINGER_JOINTS` in `skeleton.ts`); only the arms are posed straight into the
   game's A-pose before the pose is baked into the rest shape. MPFB's weights
   are renamed onto the game bones. Hands stay open at rest: `playerRig.ts`
   curls the fingers into a knife grip (right) and a relaxed hand (left) at
   runtime.
2. `armor_sets.py` with `armorkit.py` (the plate kit from the asset research
   prototype): smoothed shells are wrapped around the body, 2D plate outlines
   are projected onto them, then thickened and bevelled in two or three layers.
   `STYLES` holds each set's shape language.
3. `bake_atlas.py`: every full-resolution piece plus the body is smart-UV
   projected and packed into one atlas. LODs are cut afterwards, so they share
   the UVs, and custom normals are carried over from the full piece. Cycles then
   bakes on LOD0:
   - `armor_normal`: tangent normals, with rounded edges from a bevel shader
     plus CC0 micro detail per material (painted steel, panel seams, brushed
     metal, fabric, leather), box projected from `textures/`.
   - `armor_orm`: R = AO (each set baked against the body and itself only),
     G = roughness detail around 0.5, B = edge wear, A = grime (cavity dirt and
     run-off streaks, 1 = clean).
4. `build-armor.sh` optimizes the GLB (meshopt, 16-bit UVs) and writes WebP
   atlases (ORM at half size).

## Runtime

`library.ts` loads the GLB and the atlas. `ArmorCharacter` merges the picked
pieces, and `ArmorMaterial` colours by per-vertex material slot, samples the
atlas for normals, AO, roughness detail, edge wear and grime, and applies the
finish (Camo breaks the paint into a pattern of the three paint colours).
`ArmorCharacter` also scales a few bones after binding (legs 1.06, upper body
0.96, helmet 0.93, hips lifted to keep the feet down) so the sets read less
stubby, and `applyKnifeIdlePose` aims the armored stance in model space: knife
hand low in front, left hand in a loose guard, left foot a short step ahead.
The look travels in the `armor` part of the shared cosmetics field
(`src/network/cosmetics.ts`, `lookToArmor` / `armorToLook`).

## Budget

LOD0 is about 36k to 45k triangles per character (body about 9k), LOD1 is 40%
of that and LOD2 is 14%. `src/characters/__tests__/library.test.ts` caps LOD0
at 50k. Download: GLB about 4.7 MB plus about 2.3 MB of atlas.

## Credits

MakeHuman CC0 assets, ambientCG and Poly Haven CC0 materials: see `CREDITS.md`.

## First person

There is no separate first-person armor asset. `FirstPersonArmor` (`fpArmor.ts`)
takes the chosen kit's own forearm, elbow and hand plates from the library and
`fpTransplant.ts` moves them onto the first-person arms rig: each vertex is
carried from the body's upper arm, forearm and hand frames into the rig's
matching frames, the forearm radius is rescaled slice by slice to the sleeve,
and every vertex takes the skin weights of the nearest glove or sleeve vertex
(small pieces ride rigidly on their averaged weights) and is pushed out of it.
The plates share the atlas, finish and colours other players see. The bare
forearm is tinted to the dark undersuit while armor is worn.
