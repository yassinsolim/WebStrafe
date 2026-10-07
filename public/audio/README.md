# Audio

## Firearm recordings

The firearm shot and reload samples are Creative Commons 0 recordings from
Freesound:

- `deagle_shot.mp3`: high-quality preview of "Magnum Research Desert Eagle"
  by areniporgen, recorded close outdoors from a real .50 Action Express
  Desert Eagle, Freesound sound 712310.
  <https://freesound.org/people/areniporgen/sounds/712310/>
- `awp_shot.mp3`: high-quality preview of "Sniper Shot in Field 3 (M2010
  Enhanced Sniper Rifle ESR)" by qubodup, extracted from a real M2010 live-fire
  recording, Freesound sound 855608.
  <https://freesound.org/people/qubodup/sounds/855608/>

- `deagle_reload.mp3`: high-quality preview of "PistolReloadSound.wav" by
  MaximBomba, Freesound sound 432139.
  <https://freesound.org/people/MaximBomba/sounds/432139/>
- `awp_reload.mp3`: high-quality preview of "Rifle-or-shotgun-reload.wav" by
  MaximBomba, Freesound sound 432141.
  <https://freesound.org/people/MaximBomba/sounds/432141/>

All source pages designate the recordings under CC0 1.0:
<https://creativecommons.org/publicdomain/zero/1.0/>

The local files retain the Freesound preview encoding. They are decoded once
into the shared Web Audio engine (`src/audio/AudioEngine.ts`). Local shots play
in 2D, remote shots through a positional panner. Reload recordings are split
into natural-speed mechanical cues aligned to each authored magazine, hand,
slide and bolt event, scheduled on the audio clock.

## Procedural sounds

Everything else is synthesized at runtime in `src/audio/ProceduralSfx.ts`, with
no sample files: footsteps, jump and landing, knife deploys, flips and catches,
knife swings and stabs, knife hits on flesh and walls, backstabs, the AWP bolt
cycle, Deagle slide rack and release, dry fire, scope zoom, hitmarker, headshot
and kill confirms, UI sounds and the respawn cue. They are original WebStrafe
work.

The knife sounds follow the shape of CS2's (its 2026 set), measured from
reference clips for timing, level and spectrum only (nothing is sampled or
shipped):

- a miss is a broadband swish that swells for about 70 ms and peaks as the
  blade crosses the crosshair
- a flesh hit is a thick broadband thwack, lows as loud as the highs for about
  150 ms, with a second bright burst about 40 ms in
- a wall hit is a hard crack and about 60 ms of bright grit, then a heavy low
  thud that hangs on for about 0.3 s
- a backstab is the blade going in, shoved home about 0.18 s later, and a long
  hiss about 0.4 s on as it comes back out
- the deploy depends on the knife: a fixed blade comes out with a rising steel
  "shing" ringing near 4 to 6.6 kHz, ring knives quicker and brighter, folders
  click out of the pocket and snap open, balisong handles clack, and the push
  daggers come out as two short blades
- flips and tosses are short bright swishes, catches a soft pat in the glove

The handling sounds sit 15 to 25 dB under the hits, like in CS2.

The knife swing `.ogg` files that used to live here had no recorded source or
licence and were removed.
