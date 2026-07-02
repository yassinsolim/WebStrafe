# Viewmodel Feel — CS2-inspired weapon movement

Reference notes for how the first-person weapon (knife + guns) should *move*.
Inspired by Counter-Strike 2 / CS:GO viewmodel behaviour — **movement only**, none
of the actual CS gameplay. Implemented in `src/cosmetics/ViewmodelRenderer.ts`
and shared by the knife (`cosmeticsGroup`) and the guns (`WeaponViewmodels.root`).

The whole point: a weapon that's rigidly bolted to the camera feels dead. Real
FPS weapons have a handful of small, layered procedural motions that sell the
"held in the hands" feeling. All values are small (position deltas < 0.05,
rotation < 0.15 rad) and composited every frame.

## The layers

1. **Sway / lag** — the weapon lags a frame behind fast view rotation, then eases
   back to centre. Both a positional offset and a rotational (yaw/pitch) lag.
   Driven by the frame's look delta, clamped, and low-pass filtered. This is the
   single most important "alive" cue.

2. **Walk / run bob** — a gentle figure-8: horizontal sway at the step frequency,
   vertical bounce at twice that, plus a little roll. Amplitude scales with
   horizontal speed (0 when still, full when running).

3. **Sprint lower** — when moving fast the weapon drops slightly and pitches down
   (the "lowered ready" look). Scales with the same speed factor as the bob.

4. **Jump / land dip** — driven by vertical velocity. Rising (jump) lifts the
   weapon a touch; a hard landing punches it down + pitches up, then recovers.
   Landing intensity scales with impact speed.

5. **Fire kick** — on each shot the weapon kicks back (+Z, toward the camera) and
   the muzzle rises (pitch up), then recovers quickly. Layered on top of any
   authored fire animation clip.

## Wiring

- `ViewmodelRenderer.update(dt, worldCamera, velocity, lookDelta)` computes a
  **dynamic delta** (`motionPos` + `motionRot`) once per frame and applies
  `base + delta` to the knife root.
- `GameApp` copies that same `motionPos` / `motionRot` delta onto
  `WeaponViewmodels.root` so the guns get identical sway/bob/lower/dip — they are
  no longer statically pinned to the camera.
- `ViewmodelRenderer.addFireKick()` is called from the local fire path (guns) to
  add the recoil kick.

## Tuning knobs (in ViewmodelRenderer)

Bob amplitude/frequency, sway scale + clamps, sprint-lower amount, land-dip gain,
and fire-kick magnitude/decay are all constants at the top of `update()`. Keep
them subtle; the effect should read as "alive", never floaty or nauseating. The
`motionScale` (0..1) globally scales everything and is dropped low for the
integrated-hands mode.
