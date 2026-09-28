# Performance

The polish pass adds real-time lighting, bloom, AO, a viewmodel probe, particles
and higher detail weapons, so performance is a requirement, not an afterthought.
This page lists the budgets, how each preset scales and the measured numbers.

## Budgets

| budget | limit | now | checked by |
|---|---|---|---|
| frame time p95, Balanced, typical laptop at 1080p | 16.7 ms (60 fps) | not measured on a laptop, see below | `tools/shots/fps.mjs` |
| frame time, Balanced, M5 at 1440p | median 4.2 ms, p99 8.3 ms | median 3.0 to 3.3 ms, p99 5.6 to 7.6 ms | `tools/shots/perf.mjs` |
| frame time, High, M5 at 1440p | median 8.3 ms (120 fps), p99 16.7 ms | median 6.1 to 6.7 ms, p99 12.8 to 14.3 ms | `tools/shots/perf.mjs` |
| draw calls per frame | 150 | 65 to 93 | `calls` in `tools/shots/perf.mjs` |
| triangles per frame | 150k | 79k to 94k | `tris` in `tools/shots/perf.mjs` |
| map texture memory (scene + lightmap, transcoded) | 16 MB | 12.9 to 14.3 MB | `tools/assets/budgets.test.ts` |
| viewmodel texture memory (arms + both guns) | 12 MB | 10.4 MB | `tools/assets/budgets.test.ts` |
| map download | 8 MB | 1.4 to 2.4 MB | `src/world/__tests__/BuiltMaps.test.ts` |
| viewmodel GLB download | 1.5 MB each | 1.0 to 1.3 MB | `tools/assets/budgets.test.ts` |

Every texture ships as KTX2 (ETC1S, UASTC for the Deagle's normal map), made
by `tools/assets/ktx2-textures.ts`. They transcode to ASTC, BC7 or ETC2 on the
GPU, which is about a quarter of the memory of the WebP images they replaced
(v2 used about 46 to 52 MB of decoded textures per map). The download grew by
0.2 to 0.4 MB per map, because ETC1S compresses less than WebP. On software GL
they transcode to plain RGBA, because a software rasterizer would decode
compressed blocks on every sample.

## Scaling

- **Auto picks Balanced** on every real GPU and Low on software GL, phone GPUs
  and old Intel HD/UHD graphics. High is opt-in.
- **Adaptive resolution** is on by default for every preset. It drops the render
  scale in 15% steps whenever a one second window averages under 55 fps, down
  to half, and raises it again after three windows over 90 fps.
- **Shaders compile behind the loading screen** (`renderer.compileAsync` on the
  world and the viewmodel), so the first seconds of play don't hitch.
- Per preset (`src/render/quality.ts`, table in `docs/RENDERING.md`):
  - anti-aliasing: FXAA on Low and Balanced, 4x MSAA on High;
  - AO only on High;
  - bloom off, then 4 mips, then 6;
  - one sun shadow cascade: off, 1024, 2048;
  - particle density 0.4, 0.75 and 1;
  - bullet holes alive: 24, 48 and 96;
  - generated normal maps: none, 512, 1024;
  - pixel ratio cap 1, 1.25 and 2;
  - the viewmodel probe is off on Low.

## Measured

### M5 GPU, 2560x1440, headed Chromium, vsync off, adaptive off

These are back to back runs on the same machine at about load 8, with the
Deagle held. They use `tools/shots/perf.mjs` with an 8 s window. v2 is `main`
before this branch.

| map | v2 | Low | Balanced | High |
|---|---|---|---|---|
| Ochre Cut | 417 / 285 | 435 / 258 | 333 / 165 | 149 / 73 |
| Emberdrift | 417 / 266 | 455 / 261 | 323 / 144 | 149 / 68 |
| Prismline | 526 / 164 | 500 / 241 | 303 / 120 | 164 / 70 |

Values are median fps / 1% low fps (the mean of the slowest 1% of frames).
Balanced is the default. A second run while other agents were rendering on
the same machine came in 10 to 50% lower across the board (v2 included), so
treat these as best case on an idle M5.

### Worst-case proxy: software GL, 4x CPU throttle, 1280x720

This is headless Chromium on SwiftShader with
`Emulation.setCPUThrottlingRate(4)`, run through `tools/shots/fps.mjs` with a
3 s warm up and an 8 s window.

| build | Ochre Cut | Prismline |
|---|---|---|
| v2, adaptive off | 7.0 / 4.6 | 7.4 / 4.8 |
| v2, adaptive on | 19.8 / 4.8 (settles at 640x360) | |
| Low, adaptive off | 6.3 / 5.0 | 8.7 / 3.9 |
| Balanced, adaptive off | 2.8 / 1.8 | 2.7 / 2.0 |
| High, adaptive off | 1.6 / 1.1 | |
| **Auto (picks Low), adaptive on** | **20.0 / 4.9 (settles at 640x360)** | |

On the worst hardware the default experience costs the same as v2. Balanced
and High are three to five times heavier than Low there, which is why Auto
never picks them on software GL.

### What isn't measured

I had no Intel or AMD laptop to test on, so the Balanced 60 fps target on a
typical laptop is an estimate. Balanced takes about 3 ms per frame on the M5 at
1440p. At 1080p and a 1.25 pixel ratio cap on a GPU four to five times slower
(Iris Xe class), that works out to roughly 8 to 12 ms. Adaptive resolution
covers the rest. Run `tools/shots/fps.mjs` on a real laptop to confirm.

## Rerun

```bash
export PLAYWRIGHT_MODULE=<playwright index.mjs> CHROME=<chrome for testing>
# M5, per preset (dev server on the lan ip, chromium can't reach 127.0.0.1 here)
node tools/shots/perf.mjs http://<lan-ip>:<port> out.json "shot=aim_ochrecut&weapon=deagle&perf=8&adaptive=0&quality=medium=ochre_balanced"
# worst-case proxy
SOFTWARE=1 CPU_THROTTLE=4 WIDTH=1280 HEIGHT=720 SECONDS=8 node tools/shots/fps.mjs http://<lan-ip>:<port> out.json "shot=aim_ochrecut&weapon=deagle&adaptive=0&quality=low=ochre_low"
```

Results from this pass are in `tools/perf/results-polish-*.json`.
