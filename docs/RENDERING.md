# Rendering

How a WebStrafe frame is drawn after the v2 polish pass, what each quality
preset turns on, and which three.js techniques it borrows.

## Frame

`src/render/RenderPipeline.ts` owns the frame:

1. The world renders into a half float (HDR) target, with 4x MSAA on High.
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

`src/render/quality.ts`. Auto starts desktop class GPUs on High (Apple M
Pro/Max/Ultra and M3 on, GeForce GTX 10 series on and RTX, Radeon RX, Arc A and B
cards), every other real GPU on Balanced (the `medium` id), and software GL,
phone GPUs and old Intel HD/UHD graphics on Low. If auto's High pick makes
adaptive resolution drop two steps, auto settles on Balanced for the session.
Ultra is opt-in. Adaptive resolution (`src/app/AdaptiveResolution.ts`) stays on
for every preset and steps the render scale down whenever a one second window
drops below 55 fps.

| | Low | Balanced | High | Ultra |
|---|---|---|---|---|
| anti-aliasing | FXAA | FXAA | 4x MSAA (FXAA on Retina) | 8x MSAA (4x on Retina) |
| bloom | off | 4 mips | 6 mips | 6 mips |
| SSAO | off | off | half res | half res |
| sun shadows (players, one cascade) | off | 1024 | 2048 | 4096 |
| world materials | Lambert over the lightmap | standard, generated normal maps and gloss | same as Balanced | same as Balanced |
| generated normal maps | none | 512 | 1024 | 2048 |
| texture filtering (anisotropic) | 2x | 4x | 8x | 16x |
| viewmodel light | sky capture | world probe | world probe | world probe |
| pixel ratio cap | 1 | 1.25 | 2 | 2 |
| particle density | 0.4 | 0.75 | 1 | 1 |
| bullet holes alive | 24 | 48 | 96 | 128 |

Settings > Video > Advanced lets the player override anti-aliasing (off, FXAA,
2x, 4x or 8x MSAA), shadows, AO, bloom and texture filtering on top of any
preset (`applyOverrides`). The resolution scale goes from 50% to 200%; over
100% supersamples, capped at 3 drawing buffer pixels per CSS pixel.

"Retina" means 1.75 or more drawing buffer pixels per CSS pixel before the
adaptive scale (`GameApp.pipelinePreset`). There the MSAA resolve costs the
most and the small pixels hide the edges, so High's preset anti-aliasing turns
into FXAA and Ultra's into 4x. An anti-aliasing mode picked under Advanced is
always used as is.

Balanced drops MSAA on purpose. three.js resolves a multisampled target after
every `render()` call and the frame renders the world and the viewmodel in two
calls, so MSAA costs two full resolves per frame. On the M5 at 1440p that was
the single biggest cost (about 3 ms for 4x).

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

Budgets, scaling rules and measured fps are in `docs/PERFORMANCE.md`.
