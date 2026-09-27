# Credits

Generated from `src/credits.ts` (run `npx tsx tools/generate-credits.ts`). The same
list is shown in the in-game Credits tab. Maps added to `public/maps/manifest.json`
without an entry here are still credited in-game from their manifest fields.

WebStrafe does not ship Valve or Counter-Strike assets. Anything not listed
below is original WebStrafe work.

## Weapon models and animation

- [Desert Eagle | First Person Animations](https://sketchfab.com/3d-models/desert-eagle-first-person-animations-09a213d8510a42d1b747135e85712eff) by 1Matzh. License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
  Files: `public/viewmodels/deagle/deagle.glb`, `public/viewmodels/shared/deagle-watch.glb`.
  The uploader credits the pistol model to ELIZION and the arms to "Division Agent (Rigged)" by Blue-Spirit, edited by 1Matzh. The watch is cut from this rig.
- [AWP with Anims](https://sketchfab.com/3d-models/awp-with-anims-d45669ad333d4885a854fcf899628a39) by Addison Ye (redethox). License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
  Files: `public/viewmodels/awp/awp.glb`.

## Knives

- [knife animated (legacy arms and knife rig)](https://sketchfab.com/bumstrum) by DJMaesen. License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
  Files: `public/viewmodels/knife/knife.glb`, `public/viewmodels/knife/knife_animated.glb`.
  DJMaesen has several "knife animated" uploads, all CC Attribution. Which one was imported was not recorded.

## Audio

- [Magnum Research Desert Eagle](https://freesound.org/people/areniporgen/sounds/712310/) by areniporgen. License: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
  Files: `public/audio/deagle_shot.mp3`.
- [Sniper Shot in Field 3 (M2010 Enhanced Sniper Rifle ESR)](https://freesound.org/people/qubodup/sounds/855608/) by qubodup. License: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
  Files: `public/audio/awp_shot.mp3`.
- [PistolReloadSound.wav](https://freesound.org/people/MaximBomba/sounds/432139/) by MaximBomba. License: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
  Files: `public/audio/deagle_reload.mp3`.
- [Rifle-or-shotgun-reload.wav](https://freesound.org/people/MaximBomba/sounds/432141/) by MaximBomba. License: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
  Files: `public/audio/awp_reload.mp3`.

## Fonts

- [Rajdhani](https://fonts.google.com/specimen/Rajdhani) by Indian Type Foundry. License: [SIL Open Font License 1.1](https://openfontlicense.org/open-font-license-official-text/).
  Loaded from Google Fonts.
- [Space Mono](https://fonts.google.com/specimen/Space+Mono) by Colophon Foundry (The Space Mono Project Authors). License: [SIL Open Font License 1.1](https://openfontlicense.org/open-font-license-official-text/).
  Loaded from Google Fonts.

## Software

- [three.js](https://threejs.org/) by mrdoob and contributors. License: [MIT](https://opensource.org/license/mit).
- [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) by Garrett Johnson. License: [MIT](https://opensource.org/license/mit).
- [idb](https://github.com/jakearchibald/idb) by Jake Archibald. License: [ISC](https://opensource.org/license/isc-license-txt).
- [supabase-js](https://github.com/supabase/supabase-js) by Supabase. License: [MIT](https://opensource.org/license/mit).
- [ws](https://github.com/websockets/ws) by Einar Otto Stangvik and contributors. License: [MIT](https://opensource.org/license/mit).

## Original WebStrafe work

- All 20 procedural knives by WebStrafe. License: Original work.
  Files: `src/cosmetics/ProceduralKnife.ts`, `src/combat/knives.ts`.
- Procedural sound effects (movement, knife, bolt, slide, confirms, UI) by WebStrafe. License: Original work.
  Files: `src/audio/ProceduralSfx.ts`.
- HUD, menu, crosshair and weapon icons by WebStrafe. License: Original work.
  Files: `src/ui/hud/icons.ts`.
- Prismline, Emberdrift, Ochre Cut and the movement test scene (built by our Blender scripts in tools/blender/maps) by WebStrafe. License: Original work.
  Files: `public/maps/surf_prismline/scene.glb`, `public/maps/bhop_emberdrift/scene.glb`, `public/maps/aim_ochrecut/scene.glb`, `public/maps/movement_test_scene/scene.glb`.
- First-person arms, wristwatch, Deagle and AWP (built by our Blender scripts in tools/blender) by WebStrafe. License: Original work.
  Files: `public/viewmodels/v2/arms.glb`, `public/viewmodels/v2/deagle.glb`, `public/viewmodels/v2/awp.glb`.
- Procedural player models by WebStrafe. License: Original work.
  Files: `src/multiplayer/ProceduralPlayer.ts`.
- Placeholder gloves, knife and textures by WebStrafe. License: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
  Files: `public/cosmetics/models/gloves_placeholder.glb`, `public/cosmetics/models/knife_placeholder.glb`.
