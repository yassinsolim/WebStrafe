# Character and Viewmodel Presentation

Reference notes for the menu character and first-person weapon presentation.
The motion language is inspired by polished tactical shooters, without copying
proprietary assets, animation data, or gameplay. Shared camera-space movement is
implemented in `src/cosmetics/ViewmodelRenderer.ts`; authored knife actions live
in `src/cosmetics/KnifePresentationMotion.ts`; firearm-local mechanics live in
`src/cosmetics/WeaponViewmodels.ts`.

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

6. **Reload presentation** — combat timing stays authoritative while the visible
   weapon samples its licensed source rig's authored reload clip by normalized
   gameplay progress. Both firearms expose the magazine well, remove the old
   magazine, bring a magazine back with the support hand, and recover exactly to
   neutral. Sampling instead of free-running the mixer keeps the visible hands,
   magazine, and weapon synchronized with the 3.33 s Deagle and 3.45 s AWP
   combat timers.

## Character and grip rules

- The menu stage must remain inside the viewport. `CharacterPreview` computes a
  perspective fit from the complete posed bounding box and recomputes it after
  every resize, so narrow and fullscreen layouts retain the full body.
- Menu idle (`applyMenuIdlePose` in `playerRig.ts`, the `'menu'` character
  pose): relaxed and sure of itself. Weight on the right leg with the hips
  tipped over it and the shoulders tipped back the other way, the left knee easy
  on the ball of the foot, the knife arm hanging with the blade down along the
  leg and the free hand loose. It breathes, drifts its weight, looks around
  slowly, and every 11 s brings the knife up beside the shoulder and twirls it
  once round the grip before letting it hang again. The menu character holds
  the player's own knife and finish. Rigs without mpfb hands keep the stance.
- Exposed player eyes receive small iris, pupil, and catchlight discs attached to
  the eye bones over a warm sclera cover, so the source texture cannot fall back
  to a flat white stare. Counter-terrorist gas-mask lenses remain untouched.
- The menu knife follows the weapon-hand helper while the anatomical wrist and
  fingers rotate into the grip. In the menu idle the knife is turned about its
  grip so the blade carries on 50 degrees off the fist instead of leaning back
  past the wrist, which would point it up into the hip while the arm hangs.
- The integrated first-person knife rig is enlarged and recentered so both hands
  and the complete idle blade stay readable through idle and attack motion.
- First-person knife clips walk the knife through whole key poses
  (`src/viewmodel/knifePoses.ts`): each pose says where the grip sits, where the
  blade points, where the spine faces and where the elbow points, per way of
  holding a knife. Positions run along a centripetal Catmull-Rom curve through
  the keys (`clip.seq`), so swings arc and pass through keys without stopping,
  and a new clip starts from wherever the last one left the knife. The poses
  were solved for a natural wrist with the pose scan tools, so the edge leads
  every slash where the wrist allows it.
- Like CS2, only the knife hand shows (both for the shadow daggers). Slashes
  wind up for a few frames, cut through the crosshair edge first by about
  0.12 s (the hit lands on the click) and carry through before a slower
  settle; the forehand sweeps down to the left, the backhand comes back up to
  the right. The stab draws back high on the right and drives in at the
  crosshair; the backstab goes higher and drives in and down. Draws come up
  from low on the right with the knife's flourish (twirl, toss, flip open,
  switch, balisong, ring spin) and settle by about 0.6 to 0.9 s. The shadow
  daggers jab one fist at a time (`clip.seqL` moves the left on its own).
- Ring knives (karambit, talon) idle with the claw out to the left of the fist
  curving up, its flat to the eye; slashes rake the claw across behind the fist,
  the heavy cocks it high and rips it down. Inspects show one flat, then the
  other, then a flourish (twirl, toss, fold and flick or fan, depending on the
  knife); about one press in five plays the knife's rarer inspect instead, and
  pressing inspect again restarts it.
- The Deagle retains its authored two-hand rig. Disconnected source clothing is
  removed during export, so no synthetic forearm or duplicate hand is added at
  runtime.
- Every item shares one slim cyborg arms rig: dark synthetic muscle under thin
  plates, so the hands never hide the knife. The player's arms piece picks the
  plate kit and the look paints it (`docs/assets/arms.md`).
- Knife and AWP reuse the exact static `Watch` and `Watch_Emission` geometry
  extracted from the authored Deagle reload rig. The attachment follows the
  skinned wrist and faces the ancestor viewmodel camera, never world origin.
- Deagle and AWP use the same viewmodel camera. AWP framing is normalized from
  the rifle body rather than its long forearms, then its wrists are proportioned
  against the Deagle reference so the hands no longer read as miniature. The
  rifle is reduced and raised enough to keep its scope, receiver, hands, and
  stock readable without changing barrel alignment.
- A valid close-range target facing away smoothly raises the knife into a
  one-handed reverse-grip backstab-ready stance. Readiness blends tracked nodes
  toward an authored secondary-stab frame, rotates only the blade downward, and
  reversibly collapses the support arm after each mixer update. The normal
  two-hand idle returns when range, aim, facing, elevation, life state, or line
  of sight becomes invalid.
- Pointer-lock transitions clear pending look input and discard the first stale
  movement event. Normal raw deltas accumulate without clipping; only isolated
  per-event spikes above 512 counts are rejected.

## Wiring

- `ViewmodelRenderer.update(dt, worldCamera, velocity, lookDelta)` computes a
  **dynamic delta** (`motionPos` + `motionRot`) once per frame. Each weapon uses
  the same motion language with its own scale: the knife is lightest and most
  agile, the Deagle is restrained, and the AWP is heaviest.
- `GameApp` copies that delta onto `WeaponViewmodels.root`; the knife receives it
  through the renderer root. Gun seating and firearm recoil remain independent.
- `KnifePresentationMotion` adds a short equip settle and restrained
  primary/secondary envelopes around the exact baked clip durations. Every
  envelope reaches a zero delta before returning to idle, avoiding pose snaps.
- `ViewmodelRenderer.addFireKick()` is called from the local fire path (guns) to
  add the recoil kick.
- `Y` starts a client-side inspect only from an idle weapon. The shared envelope
  eases into a side reveal, holds long enough to read the model, and returns to
  exact idle; firing, attacking, reloading, switching, death, and menu lifecycle
  changes cancel it immediately.
- `GameApp.reloadCombatWeapon()` starts the combat timer, authored firearm reload
  sampling, shared camera-space reveal, multiplayer event, and reload audio from
  the same accepted input edge.
- Reload audio follows authored magazine release/drop, support-hand insertion,
  seating, and slide/bolt motion using weapon-specific CC0 recordings. Weapon
  switches cancel pending or playing reload samples before the selected model
  returns.
- The knife and AWP reuse the authored Deagle watch geometry. Each clone is
  parented directly to its animated wrist so movement and authored clips cannot
  make the watch drift independently of the hand.
- Knife swings use reduced gain and a narrow, lower playback-rate variation to
  keep the source attacks readable without harsh volume or pitch spikes.

## Tuning knobs (in ViewmodelRenderer)

Bob amplitude/frequency, sway scale + clamps, sprint-lower amount, land-dip gain,
fire-kick magnitude/decay, firearm reload reveal, and authored-clip seating are
the main tuning surfaces. Keep them subtle; the effect should read as "alive",
never floaty, clipped, or nauseating. The integrated knife applies a bounded
gain to the shared motion scale so its large baked hand rig remains readable
without changing the firearm profiles.
