# Characters

Players wear a whole-body **skin** (the default) or the older **kit**.

## Skins

Artist-made, rigged sci-fi characters from Sketchfab (CC BY 4.0, credited in
`CREDITS.md` and on the skin cards in the customize screen), re-posed onto the
game skeleton:

| id | model | author | rig |
| --- | --- | --- | --- |
| `ronin` (T default) | [Sci-FI Warrior Armor](https://sketchfab.com/3d-models/sci-fi-warrior-armor-9932cc103f2c4daf8aadfc340f04ac00) | Vasian-Digital3D | Character Creator |
| `sentinel` (CT default) | [Security Cyborg](https://sketchfab.com/3d-models/security-cyborg-94ea8c717c374e3fa8aaa7549235b323) | fletcherkinnear | Mixamo |

The sources stay outside the repo. Fetch them with a Sketchfab API token in
`~/.config/webstrafe/sketchfab-token.txt` (the script only accepts CC BY and
CC0 and writes a `license.json` next to each model):

```sh
node tools/assets/sketchfab-fetch.mjs 9932cc103f2c4daf8aadfc340f04ac00   # ~/Assets/webstrafe/sketchfab/sci-fi-warrior-armor
node tools/assets/sketchfab-fetch.mjs 94ea8c717c374e3fa8aaa7549235b323   # ~/Assets/webstrafe/sketchfab/security-cyborg
sh tools/characters/build-skins.sh [ronin,sentinel]                      # RENDERS=<dir> for blender stills
```

Per skin it writes `public/characters/skins/<id>.glb` (3 LODs), `<id>_arms.glb`
(first-person arms) and four WebP atlases: `_color` (albedo), `_normal`, `_data`
(R glow, G roughness, B metalness) and `_mask` (R/G/B paint zones). About 2.3 MB
(Ronin) and 2 MB (Sentinel) together; LOD0 is 54k triangles (Ronin) and 22k
(Sentinel), the first-person arms 7k and 2.5k per arm.

### Pipeline

1. `tools/blender/characters/build_skins.py` imports the source and maps its
   bones onto the game's (`cc_map`, `mixamo_map`; twist, share, face and toe
   bones follow their nearest mapped parent; CC's elbow and knee share bones
   go to the game's cap helpers). It scales the model so the neck sits at the
   game's neck height and puts the soles on the floor.
2. Each skin keeps its own proportions. Its joints keep the source's spine,
   neck, head, clavicle and hip positions; the limbs and fingers take the game
   skeleton's bone directions with the source's bone lengths. The source rig is
   posed into that bind pose (limbs only turn, nothing stretches) and baked.
   The hand turns as a whole frame (knuckle line and palm) onto the game's hand.
3. Each source material gets a cell of one 2048 atlas and its UVs move into it.
   `tools/characters/skin_textures.py` fills the cells from the source textures
   with the base colour, roughness and metal factors baked in, and builds the
   paint masks (`PAINT`: per material, a lightness band plus near-grey or hue
   tests). Per-material metal and roughness scales stand in for extensions we
   don't render (the Sentinel's `KHR_materials_specular`). The zones' mean
   colours and luminances go into `SKIN_INFO` in `src/characters/catalog.ts`.
4. Emblem and callsign spots are ray cast onto the flattest front-facing points
   of the upper chest.
5. First-person arms: each arm is cut from the conformed body (faces mostly
   weighted to the arm, hand and fingers) and posed onto the first-person rig
   from `tools/blender/arms` (the joints the grips are fitted to). The limbs
   turn and scale onto its bones, the hand scales to its palm length, then the
   palm-down roll is spread along the forearm instead of twisting at the wrist.
   The artist's normals turn with every vertex. Weights move onto the rig's
   bones, with the forearm split over `forearm_twist` by the rig's twist ramp.
   The arms reuse the skin's atlas.

To add a skin: fetch a rigged humanoid (CC, Mixamo or a new map in `RIG_MAPS`),
add it to `SKINS` in `build_skins.py` with an atlas cell per material, add its
paint zones to `PAINT` in `skin_textures.py`, then add it to `SKINS` and
`SKIN_INFO` in `catalog.ts` and to `src/credits.ts`.

### Runtime

`skins.ts` loads every skin with the armor library (a skin that fails to load
falls back to the kit). `ArmorCharacter` moves the shared skeleton onto the
skin's joints (same bone orientations, so `playerRig.ts` poses it unchanged)
and draws it with `SkinMaterial`: the atlas plus three paint zones. A zone whose
look colour is the skin's own colour shows the art untouched; any other colour
repaints it, scaled by each texel's luminance over the zone's mean so shading
and grime survive. The finish pushes the painted zones' roughness and metal.
Lights glow in the team colour like the kit's. `FirstPersonArmor` loads
`<id>_arms.glb` the first time a look wears the skin, swaps its bones for the
arms rig's by name (the rest poses match, `tools/assets/skinArms.test.ts`
checks) and hides the kit arms and the watch.

The look (`look.ts`) has `skin: 'ronin' | 'sentinel' | 'kit'`, two letters on
the version 2 wire (`rn`, `sn`, `kt`); version 1 looks from older clients read
as the kit. Looks saved before skins existed start on the default skin in its
own paint.

# Armored kit

The older characters: a real human body under five swappable armor sets
(Strafe, Anvil, Vector, Quill, Edge), five slots each (helmet, arms, chest, legs,
class item). Edge has slim gloss plates over chrome under-layers on the
synthetic muscle suit, segmented armour on every
finger bone, a blade visor and an empty scabbard across the back. Its pieces are
in `tools/blender/characters/edge_set.py`; the other sets share `armor_sets.py`. Any mix of pieces merges into one skinned mesh per LOD with one
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

LOD0 is about 36k to 62k triangles per character (body about 9k, Edge the
heaviest for its finger segments), LOD1 is 40% of that and LOD2 is 14%.
`src/characters/__tests__/library.test.ts` caps LOD0 at 65k. Download: GLB
about 5.6 MB plus about 3.5 MB of atlas.

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
