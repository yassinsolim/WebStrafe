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

## Knife recordings

The 32 mono MP3 clips in `knife/` are edited from eleven CC0 Freesound
recordings. They replace synthesized knife sounds when decoded. Exact source
URLs, authors, input/output hashes and measured peaks are in
[`knife/sources.json`](knife/sources.json); attribution also appears in
[`CREDITS.md`](../../CREDITS.md#audio) and the in-game credits.

The recordings cover knife swishes, a training butterfly knife, pocket-knife
and assisted-opening snaps, cloth, steel scrapes, foam prop impacts,
blade-to-anvil contacts and a melon-foley withdrawal. Catch and closing cues
reuse quieter edited prop contacts; they are not recordings of those exact
in-game actions. No Valve recordings or audio extracted from CS2 footage ship.

Rebuild with Node and FFmpeg installed:

```sh
node tools/assets/build-knife-audio.mjs [source-cache-directory]
```

The default cache is `webstrafe-knife-foley` under the system temporary
directory. The build downloads public high-quality previews, checks the source
pages for CC0, trims and filters the selected sections, aligns their peaks,
level-matches them and validates each encoded result. The original downloads
and licence-page receipts remain in the cache, outside the shipped asset set.

`KnifeAudio` preloads the clips on Play. Three recorded takes alternate for
swings, opening snaps, butterfly contacts and impacts. Draws use different
fixed-blade, ring and pocket handling; the Stiletto has its own opening snap.
Inspects include quiet cloth cues and distinguish closing from opening.

The recording's peak is scheduled to the attack phase in `knifeClips.ts`, not
the input edge: straight-blade stabs contact at 0.13 s, ring-knife stabs at
0.30 s, and backstabs have their own timings. Wall sounds use the same contact
time. Early local hit confirmations wait only until that visual contact;
late confirmations play immediately. Damage and server timing are unchanged.

Switches and interrupted inspects stop hand sounds, including queued voices.
Confirmed world impacts keep their tails. Remote swings and impacts remain
positional. The procedural recipes are fallbacks while a recording is loading
or if decoding fails; they are not layered over a successfully played clip.

## Procedural sounds

`src/audio/ProceduralSfx.ts` still synthesizes footsteps, jump and landing,
katana sounds, the AWP bolt cycle, Deagle slide rack and release, dry fire,
scope zoom, hitmarker, headshot and kill confirms, UI sounds and the respawn
cue, along with the knife loading/error fallbacks. These are original
WebStrafe work.

The knife swing `.ogg` files that used to live here had no recorded source or
licence and were removed.
