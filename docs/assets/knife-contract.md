# Knife asset contract (v2 knives)

Three pieces meet here: the knife models (Blender), the finish system (shaders)
and the grips and animations (viewmodel). Anything that changes this contract
has to change all three.

## Files

- `public/knives/<id>.glb`, one per knife id in `src/combat/knives.ts`, built by
  committed bpy scripts in `tools/blender/knives/` and optimized with
  `tools/assets/optimize-glb.ts` (meshopt, WebP textures).
- Budget: LOD0 at most 15,000 triangles and 1.5 MB per knife (textures
  included). `public/knives/<id>_lod1.glb` is the third-person LOD: the same
  nodes, sockets and userData at under half the triangles, at most 400 KB.
- All geometry is original: modelled from real-world knife layouts, with CS2
  used only as visual reference. No downloaded meshes or textures.

## Frame (three.js axes after export)

- Metres, real-world size.
- +X runs from the guard towards the tip, +Y is the spine side, the edge faces
  -Y, and Z is the thickness (the blade's flat faces point along +Z and -Z).
- The origin is where the hand meets the guard or bolster (the front of the
  handle), the same frame the old procedural knives used.

## Nodes

Moving parts are empties on their pivot, with the geometry in a child named
`<part>_mesh`. meshopt quantization moves the origin of childless mesh nodes, so
a pivot must never carry the mesh itself.

| node | knives | motion |
|---|---|---|
| `blade_pivot` | folders: flip, falchion, navaja, stiletto, talon, ursus, nomad | `rotation.z` 0 is open, -PI is closed into the handle |
| `handle_safe`, `handle_bite` | butterfly | `rotation.z` 0 is open (handles together); `handle_safe` closes to -PI and `handle_bite` to +PI, so the halves swing round the spine and edge without crossing (the procedural fallback knife uses the opposite signs) |
| `socket_grip` | all | centre of a hammer-grip fist on the handle |
| `socket_tip` | all | blade tip (child of `blade_pivot` on folders) |
| `socket_ring` | karambit, talon | centre of the finger ring. Its local +Z is the ring's axis (the direction a finger goes through) |
| `socket_pivot` | folders | the pivot pin |
| `socket_pivot_safe`, `socket_pivot_bite` | butterfly | the two tang pins |
| `socket_tee` | shadow_daggers | centre of the T-handle bar, local +Z along the bar |

Folders in CS2 terms: flip, falchion, navaja, stiletto, talon, ursus, nomad
open with `blade_pivot`. The gut knife, bayonets, huntsman, bowie, classic,
paracord, survival, skeleton, kukri and karambit are fixed blades.

## userData hints (glTF extras) on the knife root

- `grip`: `hammer`, `reverse_ring` (karambit, talon: index finger through the
  ring, blade below the little finger), `balisong`, or `tee` (push daggers).
- `handleLength`, `handleThickness` (metres, across Z), `handleHeight` (across Y).
- `ringInnerRadius` (metres) on ring knives.
- `bladeLength` (guard to tip, metres) and `bladeHeight` (spine to edge at the widest).
- `pair: true` on shadow_daggers (the viewmodel builds two).

## Materials

Material names are the hook for the finish system.

| material | on | finish |
|---|---|---|
| `knife_blade` | blade faces | replaced by the finish |
| `knife_edge` | the sharpened bevel | the finish, brightened (polished edge) |
| `knife_handle` | grip scales, wraps, moulded handles | some finishes tint it (Crimson Web, Night, Safari Mesh, Boreal Forest, Scorched, Case Hardened, Slaughter keep a dark handle) |
| `knife_metal` | guards, bolsters, pins, rings, skeleton frames | follows the blade on full-metal knives (skeleton, karambit ring) |
| `knife_accent` | lanyards, spacers, details | untouched |

Finish shaders work in knife space, not UV space: the finish system computes
blade coordinates from the vertex position in the knife root's frame
(`u = x / bladeLength`, `v` from spine to edge using `bladeHeight`), so models
don't need special UVs. Models ship a 0..1 UV0 atlas with baked base colour,
normal and ORM (occlusion, roughness, metalness) maps on every material; the
steel's normal map is `knife_blade`'s `normalMap`, so a finish that replaces
the blade material can keep it (and `aoMap`, the ORM image, likewise).
