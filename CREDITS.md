# Credits

Generated from `src/credits.ts` (run `npx tsx tools/generate-credits.ts`). The same
list is shown in the in-game Credits tab. Maps added to `public/maps/manifest.json`
without an entry here are still credited in-game from their manifest fields.

WebStrafe does not ship Valve or Counter-Strike assets. Anything not listed
below is original WebStrafe work.

## Weapon models and animation

- [Scratches005 (scratch mask, bake source for the Deagle and AWP wear)](https://ambientcg.com/view?id=Scratches005) by ambientCG. License: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
  Files: `tools/blender/weapons/textures/scratches.jpg`.
  Opacity map downscaled to 1024 px, used only as a bake input.
- [Metal009 (brushed steel roughness, bake source for the gun metal)](https://ambientcg.com/view?id=Metal009) by ambientCG. License: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
  Files: `tools/blender/weapons/textures/brushed_steel_rough.jpg`.
  Roughness map downscaled to 1024 px, used only as a bake input.
- [Plastic012B (scratched plastic roughness, bake source for polymer, rubber and matte finishes)](https://ambientcg.com/view?id=Plastic012B) by ambientCG. License: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
  Files: `tools/blender/weapons/textures/plastic_rough.jpg`.
  Roughness map downscaled to 1024 px, used only as a bake input.

## Player models

- ["Sci-FI Warrior Armor", the Ronin skin](https://sketchfab.com/3d-models/sci-fi-warrior-armor-9932cc103f2c4daf8aadfc340f04ac00) by Vasian-Digital3D. License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
  Files: `public/characters/skins/ronin.glb`, `public/characters/skins/ronin_arms.glb`, `public/characters/skins/ronin_color.webp`, `public/characters/skins/ronin_normal.webp`, `public/characters/skins/ronin_data.webp`, `public/characters/skins/ronin_mask.webp`.
  Changed: re-posed and re-weighted onto the WebStrafe skeleton, first-person arms cut from it, textures packed into one atlas with paint masks, lods.
- ["Security Cyborg", the Sentinel skin](https://sketchfab.com/3d-models/security-cyborg-94ea8c717c374e3fa8aaa7549235b323) by fletcherkinnear. License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
  Files: `public/characters/skins/sentinel.glb`, `public/characters/skins/sentinel_arms.glb`, `public/characters/skins/sentinel_color.webp`, `public/characters/skins/sentinel_normal.webp`, `public/characters/skins/sentinel_data.webp`, `public/characters/skins/sentinel_mask.webp`.
  Changed: re-posed and re-weighted onto the WebStrafe skeleton, first-person arms cut from it, textures packed into one atlas with paint masks and less metal, lods. The rifle from the original scene is left out.
- [Base human body under the armor (MakeHuman system assets, posed and skinned with the MPFB2 Blender add-on)](https://static.makehumancommunity.org/about/license.html) by MakeHuman Community. License: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
  Files: `public/characters/armor.glb`.
  MPFB2 itself (GPL) is only used as a build tool; the assets it places are CC0.
- [Metal027, Metal009, MetalPlates017A, Fabric004, Leather014 and Scratches005 surface detail, baked into the armor atlas](https://ambientcg.com) by ambientCG. License: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
  Files: `public/characters/armor_normal.webp`, `public/characters/armor_orm.webp`, `tools/blender/characters/textures/metal027_n.jpg`, `tools/blender/characters/textures/metal009_n.jpg`, `tools/blender/characters/textures/metalplates017a_n.jpg`, `tools/blender/characters/textures/fabric004_n.jpg`, `tools/blender/characters/textures/leather014_n.jpg`, `tools/blender/characters/textures/scratches005.jpg`.
- [Bi-stretch fabric (undersuit detail), baked into the armor atlas](https://polyhaven.com/a/bi_stretch) by Poly Haven. License: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
  Files: `tools/blender/characters/textures/bi_stretch_n.jpg`, `tools/blender/characters/textures/bi_stretch_r.jpg`.

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
- [Barlow Semi Condensed](https://fonts.google.com/specimen/Barlow+Semi+Condensed) by Jeremy Tribby (The Barlow Project Authors). License: [SIL Open Font License 1.1](https://openfontlicense.org/open-font-license-official-text/).
  Loaded from Google Fonts. Used for hud numbers and body text because it has tabular figures.

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
- HUD, menu, crosshair, logo mark and weapon icons by WebStrafe. License: Original work.
  Files: `src/ui/hud/icons.ts`, `src/ui/brand.ts`, `public/favicon.svg`.
- Prismline, Emberdrift, Ochre Cut and the movement test scene (built by our Blender scripts in tools/blender/maps) by WebStrafe. License: Original work.
  Files: `public/maps/surf_prismline/scene.glb`, `public/maps/bhop_emberdrift/scene.glb`, `public/maps/aim_ochrecut/scene.glb`, `public/maps/movement_test_scene/scene.glb`.
- First-person arms, wristwatch, Deagle, AWP and katana (built by our Blender scripts in tools/blender) by WebStrafe. License: Original work.
  Files: `public/viewmodels/v2/arms.glb`, `public/viewmodels/v2/deagle.glb`, `public/viewmodels/v2/awp.glb`, `public/viewmodels/v2/katana.glb`.
- Procedural player models by WebStrafe. License: Original work.
  Files: `src/multiplayer/ProceduralPlayer.ts`.
- Strafe, Anvil, Vector, Quill and Edge armor sets (built by our Blender scripts in tools/blender/characters) by WebStrafe. License: Original work.
  Files: `public/characters/armor.glb`, `tools/blender/characters/armor_sets.py`, `tools/blender/characters/edge_set.py`.
- Placeholder gloves, knife and textures by WebStrafe. License: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
  Files: `public/cosmetics/models/gloves_placeholder.glb`, `public/cosmetics/models/knife_placeholder.glb`.
