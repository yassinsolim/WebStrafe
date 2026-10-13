# Character and Viewmodel Presentation

Reference notes for the menu character and first-person weapon presentation.
The motion language is inspired by polished tactical shooters, without copying
proprietary assets, animation data, or gameplay. Shared camera-space movement is
implemented in `src/cosmetics/ViewmodelRenderer.ts`; the arms, knives and guns
and their clips live in `src/viewmodel/` (`ViewmodelSystem.ts`, `clips.ts`,
`knifeClips.ts`, `viewmodelClips.ts`); the springs and blends everything
shares are in `src/viewmodel/motion.ts`.

The whole point: a weapon that's rigidly bolted to the camera feels dead. Real
FPS weapons have a handful of small, layered procedural motions that sell the
"held in the hands" feeling. All values are small (position deltas < 0.05,
rotation < 0.15 rad) and composited every frame.

## The layers

1. **Sway / lag** — the weapon lags behind fast view rotation, then eases
   back to centre. Both a positional offset and a rotational (yaw/pitch) lag.
   Driven by the look rate (per second, so it is the same at any frame rate),
   clamped, and followed on a critically damped spring; heavier guns lag more.
   This is the single most important "alive" cue.

2. **Walk / run bob** — a gentle figure-8: horizontal sway at the step frequency,
   vertical bounce at twice that, plus a little roll. Amplitude follows
   horizontal speed on a spring and only plays with feet on the ground (not
   while bhopping or surfing).

3. **Sprint lower** — when moving fast the weapon drops slightly and pitches down
   (the "lowered ready" look). Scales with the same speed factor as the bob.

4. **Jump / land dip** — driven by vertical velocity. Rising lifts the weapon a
   touch on a spring; a hard landing kicks a spring downward, so the dip builds
   over a few frames and settles instead of popping in one.

5. **Fire kick** — on each shot the weapon kicks back (+Z, toward the camera) and
   the muzzle rises (pitch up), then recovers. A shot fired during a recovery
   stacks on top of it (softly topped out) instead of snapping it back to zero.

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
  on the ball of the foot, the knife arm hanging with the knife held forward
  and a little out, edge down, and the free hand loose. It breathes, drifts its
  weight, looks around slowly, and every 11 s brings the knife up beside the
  shoulder and twirls it once before letting it hang again. The menu character
  holds the player's own knife and finish. Rigs without mpfb hands keep the
  stance.
- Exposed player eyes receive small iris, pupil, and catchlight discs attached to
  the eye bones over a warm sclera cover, so the source texture cannot fall back
  to a flat white stare. Counter-terrorist gas-mask lenses remain untouched.
- The menu knife follows the weapon-hand helper while the anatomical wrist and
  fingers rotate into the grip, seated as in the combat stance (blade out of
  the thumb side, edge toward the knuckles). Ring knives (karambit, talon) are
  turned end for end in the hand (`holdKnife` in `CharacterPreview.ts`): the
  index goes through the ring, the claw hangs out under the little finger with
  its flat to the front, the forearm comes forward so it stays in view, and the
  twirl spins it round the index through the ring.
- The integrated first-person knife rig is enlarged and recentered so both hands
  and the complete idle blade stay readable through idle and attack motion.
- First-person knife clips walk the knife through whole key poses
  (`src/viewmodel/knifePoses.ts`): each pose says where the grip sits, where the
  blade points, where the spine faces and where the elbow points, per way of
  holding a knife. Positions run along a centripetal Catmull-Rom curve through
  the keys (`clip.seq`), so swings arc and pass through keys without stopping,
  and a new clip starts from wherever the last one left the knife. The poses
  were solved for a natural wrist with the pose scan tools, so the edge leads
  every slash where the wrist allows it. A key can also be placed by the fist
  (`handKey`: where the fist is, where the knuckles point, where the back of
  the hand faces) and the knife follows from its grip. Keys without their own
  elbow use the grip's usual one, never the idle's.
- Knife-arm IK treats the elbow pole as a preference when it would fold the
  wrist: it moves the elbow just far enough toward a 35-degree wrist bend when
  the arm can reach that configuration. Remaining impossible targets are
  limited to 40 degrees of flexion, 45 of extension and 25 sideways. The knife
  follows the actual hand, including ring holds, so correcting the wrist does
  not detach the grip. The unoccupied support hand uses gentler limits of 20
  degrees of flexion/extension and 15 sideways. This applies to both dagger
  hands and the free support hand; firearm rig targets are unchanged.
  `tools/qa/grip-check.mjs` checks both
  visible wrists as well as finger clearance and attachment throughout the
  normal and rare clips.
- The idles were matched to a 60 fps static-camera CS2 capture (cutouts
  against a background plate; older showcase footage pans and its steady
  frames are inspects, so don't fit to it). Every knife has its own
  (`KNIFE_IDLES`, silhouette-fitted inside a natural wrist): the hammer-grip
  knives point the blade left and slightly up out of a low fist at the bottom
  right, the bowie lies almost level, the shadow daggers angle in from two low
  fists. Knives without one use their grip's idle.
- Like CS2, the free hand waits low left of the middle (`KNIFE_LEFT_FISTS`,
  fitted to the same capture): a loose fist for the hammer grips, open for
  the karambit and talon, none for the bowie. It drops out of view as an
  attack or inspect starts and comes back up as the knife settles
  (`leftDrop`).
- Every knife's slashes and stab are fitted frame by frame to the capture
  (`knifeAttackFits.ts`): each visible 60 fps frame was cut out and the knife
  and arm posed until their outline matched it, inside a natural wrist. The
  fit tracks the previous frame rather than searching wide, since a knife
  turned about its blade or a hand nearer the camera can have nearly the same
  outline and hopping between them reads as jitter. The track is then
  smoothed (the twist about the blade and the elbow most) and keyed every
  2 frames. At load the keys are resampled every frame, smoothed again over
  about a frame and a half and keyed every other frame
  (`knifePoses.fittedAttackTrack`), which keeps the cut's speed but irons out
  the capture's wobble, gaps and held frames. Every pose sequence plays on a
  cubic hermite in time (`clips.seqWeights`): each key has one velocity, so
  the motion runs through keys instead of stopping at each, and only rests on
  holds, eased keys and the end. An
  outline alone can't tell a blade seen side on from one pointing into the
  screen, and CS2's thick sleeve and glove pull a slim arm's fit off, so 21
  of the attacks were refitted with the sleeve ignored and the blade matched
  as a line (its direction, tip and guard on screen against the bright blade
  in the capture). That cut the blade line error by about a third (0.46 to
  0.29) while the outline match barely moved (0.56 to 0.54). The other
  attacks keep the outline-only fit, because the blade-line fit jolted more
  on them (CS2's blurred blade is hard to pick out). The butterfly stab
  reaches further forward than our arm can, so it stays short. An attack
  starts on the capture's first frame already moving; the switch into it
  carries the hand there from wherever it was (see Wiring), and it settles
  into our idle over 0.18 s at the end. Out
  of view the knife is parked under the screen until it rises back the way
  CS2's does. Where the
  capture lacks an attack, the nearest knife's is used (butterfly forehand and
  flip backhand from the stiletto, gut forehand from the bayonet). The shadow
  daggers fit each fist on its own (`keysL`). The backstab and the hand-made
  clips (`ATTACKS`, `RING_ATTACKS`, `DAGGER_ATTACKS`) cover knives without a
  fit. Draws come up
  from low on the right with the knife's flourish (twirl, toss, flip open,
  switch, balisong, ring spin) and settle by about 0.6 to 0.9 s.
- Ring knives (karambit, talon) idle like CS2's (checked against gameplay
  footage, not the inspect): the fist low on the right with the back of the
  hand to the eye, leaning into the screen, the ring at the left end under the
  index and the claw out of the right end curving up. Slashes keep that hold:
  the forehand pulls the claw right to left through the crosshair, the
  backhand leads it back out to the right; the heavy cocks it high and rips it
  down. The raised fist with the claw hanging under it is the inspect, not the
  idle. Inspects show one flat, then the
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

- `ViewmodelRenderer.update(dt, worldCamera, velocity, lookDelta, grounded)`
  computes a **dynamic delta** (`motionPos` + `motionRot`) once per frame. Each
  weapon uses the same motion language with its own scale: the knife is
  lightest and most agile, the Deagle is restrained, and the AWP is heaviest.
- `GameApp` copies that delta onto `ViewmodelSystem.root`, so the arms, knives
  and guns all ride it.
- Switching clips in `ViewmodelSystem` (an attack during an attack, a cancel, a
  clip ending) never freezes or crossfades: the difference between where the
  old clip left the item, its elbow and every channel, and how fast they were
  moving, is kept as an offset that dies away on a critically damped spring
  (inertial blending, `motion.ts`). Attacks take it out fastest.
- The arm solve keeps the elbow's swing round the arm and the wrist limit's
  correction on short springs during play, so an elbow hint passing over the
  arm line or a hand asked past the wrist limit rounds the corner instead of
  whipping across. Scrubbing (`seek`, the grip check) solves each frame fresh.
- The free fist follows its clip's `leftDrop` on a spring: a clip that wants
  it down takes it down, and keeps it down when it already is.
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

## Third person

Other players (and your own body in the third person debug camera) move on
top of the knife stance (`src/multiplayer/thirdPersonMotion.ts`, posed by
`playerRig.applyBodyMotion`): a stride that follows their real ground speed
and direction (backwards and across too), hips turning with it, leans, the
chest and head following the aim pitch, the free arm swinging, legs tucked in
the air with a dip on landing, and knife attacks with a wind up, cut and
follow through that carry on from each other.

## Checking motion

- `node tools/qa/animation-audit.mjs <url> <out> [knife ...|guns] --live
  [--video]` plays every knife and gun clip and real sequences (slash spam,
  cancels, repeat fire) and counts pops, jolts, hitches, finger snaps and the
  free arm flickering. `tools/qa/animation-audit-compare.mjs` diffs two runs.
- `node tools/qa/third-person-motion.mjs <url> <out> [--video]` drives dev
  characters through walking, strafing, jumping, aiming and attacks.
- The grip check (`STEP=0.0333 node tools/qa/grip-check.mjs`) must stay at
  zero failures after any clip or finger change.
