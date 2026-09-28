# Rendering

How a WebStrafe frame is drawn after the v2 polish pass, what each quality
preset turns on, and which three.js techniques it borrows.

## Frame

`src/render/RenderPipeline.ts` owns the frame:

1. The world renders into a half float (HDR) target, with MSAA on Medium and High.
2. On High, SSAO (`Ssao.ts`) runs at half resolution on the world depth: Alchemy
   style AO over a Vogel spiral, then a depth aware blur in two passes.
3. The viewmodel renders into the same target after a depth clear, with its own
   camera and field of view.
4. Bloom (`Bloom.ts`) builds a mip chain from half resolution. It uses the
   13-tap downsample with a soft threshold and a Karis average on the first
   level, then tent upsamples added back up the chain.
5. One composite pass does everything else: AO on world pixels only, bloom,
   exposure, white balance, contrast and saturation, then a neutral tone map,
   vignette, FXAA (Low only) and dither. The result goes straight to the canvas.

The canvas itself has no MSAA and no three.js tone mapping. The grade lives in
`grade.ts` with an exact inverse, so the sky and fog colours authored in each
map's `meta.json` show on screen as authored. The tone map is Khronos PBR
Neutral with the toe at half strength (`TONE_TOE`). The full toe pulled the
lowest channel of dark colours to zero, which made warm shadows muddy.

## Presets

`src/render/quality.ts`. Auto picks from the WebGL renderer string: Apple
M-series and discrete GPUs get High, integrated Intel and older laptop GPUs get
Medium, and software GL and phone GPUs get Low. Adaptive resolution
(`src/app/AdaptiveResolution.ts`) steps the render scale down below 55 fps on
every preset.

| | Low | Medium | High |
|---|---|---|---|
| anti-aliasing | FXAA | 2x MSAA | 4x MSAA |
| bloom | off | on | on |
| SSAO | off | off | half res |
| sun shadows (players) | off | 1024 | 2048 |
| world materials | Lambert over the lightmap | standard, generated normal maps and gloss | same as Medium |
| viewmodel light | sky capture | world probe | world probe |
| pixel ratio cap | 1 | 1.5 | 2 |
| particle density | 0.5 | 0.8 | 1 |

## Lighting

- **Split lightmaps.** Cycles bakes the full diffuse light, the sun alone and the
  sun's visibility. The shipped lightmap holds indirect light in RGB and sun
  visibility in alpha (`tools/blender/maps/maplib.py`, `docs/assets/maps.md`).
  At runtime the sun is a real light scaled by the baked visibility. That gives
  sharp baked shadows plus live specular, normal maps and shadows from players.
- **Sky.** A linear HDR sky dome (gradient, sun disc, self-shadowed clouds) is
  captured to a PMREM for image based light on players.
- **Viewmodel.** `src/render/ViewmodelProbe.ts` renders a 32 px cube of the world
  at the eye, one face per frame, and prefilters it once all six are in. The gun
  and arms use it as their environment, so they pick up the floor and walls
  around the player, and the sun hits them from its real direction, dimmed by a
  ray from the eye when the player stands in shadow. Tracers, flashes and
  particles live on `EFFECTS_LAYER` so the probe never captures them.

## Effects

`src/combat/CombatEffects.ts` and `src/combat/effects/`:

- Tracers are one camera-facing capsule each (4 vertices), shaded per pixel by
  distance to the segment. The core is HDR, so bloom gives the glow without
  stacked additive quads. Tracers fly at 950 m/s (Deagle) and 1500 m/s (AWP),
  with at least 14 ms on screen, so even a wall at point blank shows a streak.
  The AWP gets a thicker, brighter core and a short heat wake.
- Muzzle flashes are star sprites in the viewmodel layer, plus a point light on
  the viewmodel.
- Impacts are GPU instanced particle bursts per surface kind (sparks, dust,
  chips, blood, smoke). Gravity, drag and stretch run in the vertex shader, so
  each burst only needs its age uniform set per frame.
- Decals are multiply blended quads with a texture per surface, so they take
  the exact light of the wall under them.
- `src/world/SurfaceProbe.ts` finds the surface kind at a hit with a
  three-mesh-bvh raycast.

## three.js techniques used

Studied from the threejs.org examples and docs, then written for this pipeline:

| technique | example it follows | where |
|---|---|---|
| HDR render target, custom composite, dithering | `webgl_postprocessing` family | `RenderPipeline.ts` |
| mip chain bloom | `webgl_postprocessing_unreal_bloom` (the idea; the filter is the 13-tap/tent version) | `Bloom.ts` |
| screen space AO | `webgl_postprocessing_sao`, `webgl_postprocessing_gtao` | `Ssao.ts` |
| neutral tone mapping | `webgl_tonemapping` (Khronos PBR Neutral) | `grade.ts` |
| PMREM image based lighting | `webgl_materials_envmaps_hdr`, `webgl_pmrem_test` | `MapEnvironment.ts` |
| dynamic cube capture for local reflections | `webgl_materials_cubemap_dynamic` | `ViewmodelProbe.ts` |
| lightmaps with a second UV set | `webgl_materials_lightmap` idea, extended with `onBeforeCompile` | `worldMaterials.ts` |
| instanced particles | `webgl_instancing_*`, `webgl_buffergeometry_instancing` | `ParticleBurst.ts` |
| decals | `webgl_decals` (the idea; quads instead of `DecalGeometry` so a hit costs nothing) | `ImpactDecals.ts` |
| BVH raycasts | three-mesh-bvh examples | `SurfaceProbe.ts` |

Considered and skipped: TAA (it smears thin tracers and adds latency; MSAA
covers geometry edges), SMAA on High (MSAA looks better on the viewmodel), and
real-time shadow maps for the whole world (the baked visibility is sharper and
free).
