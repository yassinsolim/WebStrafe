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
no sample files: footsteps, jump and landing, knife swings and stabs, knife
hits on flesh and walls, backstabs, the AWP bolt cycle, Deagle slide rack and
release, dry fire, scope zoom, hitmarker, headshot and kill confirms, UI
sounds and the respawn cue. They are original WebStrafe work.

The knife sounds follow the shape of CS2's, measured from reference clips for
length and spectrum only (nothing is sampled): a miss is a broadband swish that
swells for about 70 ms and peaks as the blade crosses the crosshair, a flesh hit
is a bright crack, a meaty thump about 30 ms later and a short hiss, and a wall
hit is a short crack and scrape with only a faint steel tick. None of them has a
pitched layer or a narrow swept filter, which is what made the old ones whirr.

The knife swing `.ogg` files that used to live here had no recorded source or
licence and were removed.
