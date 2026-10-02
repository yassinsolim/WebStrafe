/**
 * Single attribution registry. The in-game Credits tab renders it and
 * CREDITS.md is generated from it (`npx tsx tools/generate-credits.ts`).
 * A test fails when CREDITS.md drifts or a credited file disappears.
 */

export type CreditCategory =
  | 'maps'
  | 'weapons'
  | 'players'
  | 'knives'
  | 'audio'
  | 'fonts'
  | 'software'
  | 'original';

export interface CreditEntry {
  id: string;
  category: CreditCategory;
  title: string;
  author: string;
  license: string;
  licenseUrl?: string;
  sourceUrl?: string;
  /** repo paths this entry covers */
  files?: readonly string[];
  /** map manifest id, so manifest maps are not listed twice */
  mapId?: string;
  notes?: string;
}

export const CREDIT_CATEGORY_LABEL: Record<CreditCategory, string> = {
  maps: 'Maps',
  weapons: 'Weapon models and animation',
  players: 'Player models',
  knives: 'Knives',
  audio: 'Audio',
  fonts: 'Fonts',
  software: 'Software',
  original: 'Original WebStrafe work',
};

export const CREDIT_CATEGORY_ORDER: readonly CreditCategory[] = [
  'maps',
  'weapons',
  'players',
  'knives',
  'audio',
  'fonts',
  'software',
  'original',
];

const CC0 = 'https://creativecommons.org/publicdomain/zero/1.0/';
const OFL = 'https://openfontlicense.org/open-font-license-official-text/';
const MIT = 'https://opensource.org/license/mit';

export const CREDITS: readonly CreditEntry[] = [
  {
    id: 'players-makehuman-body',
    category: 'players',
    title: 'Base human body under the armor (MakeHuman system assets, posed and skinned with the MPFB2 Blender add-on)',
    author: 'MakeHuman Community',
    license: 'CC0 1.0',
    licenseUrl: CC0,
    sourceUrl: 'https://static.makehumancommunity.org/about/license.html',
    files: ['public/characters/armor.glb'],
    notes: 'MPFB2 itself (GPL) is only used as a build tool; the assets it places are CC0.',
  },
  {
    id: 'players-ambientcg-materials',
    category: 'players',
    title: 'Metal027, Metal009, MetalPlates017A, Fabric004, Leather014 and Scratches005 surface detail, baked into the armor atlas',
    author: 'ambientCG',
    license: 'CC0 1.0',
    licenseUrl: CC0,
    sourceUrl: 'https://ambientcg.com',
    files: [
      'public/characters/armor_normal.webp',
      'public/characters/armor_orm.webp',
      'tools/blender/characters/textures/metal027_n.jpg',
      'tools/blender/characters/textures/metal009_n.jpg',
      'tools/blender/characters/textures/metalplates017a_n.jpg',
      'tools/blender/characters/textures/fabric004_n.jpg',
      'tools/blender/characters/textures/leather014_n.jpg',
      'tools/blender/characters/textures/scratches005.jpg',
    ],
  },
  {
    id: 'players-polyhaven-bi-stretch',
    category: 'players',
    title: 'Bi-stretch fabric (undersuit detail), baked into the armor atlas',
    author: 'Poly Haven',
    license: 'CC0 1.0',
    licenseUrl: CC0,
    sourceUrl: 'https://polyhaven.com/a/bi_stretch',
    files: ['tools/blender/characters/textures/bi_stretch_n.jpg', 'tools/blender/characters/textures/bi_stretch_r.jpg'],
  },
  {
    id: 'weapons-ambientcg-scratches005',
    category: 'weapons',
    title: 'Scratches005 (scratch mask, bake source for the Deagle and AWP wear)',
    author: 'ambientCG',
    license: 'CC0 1.0',
    licenseUrl: CC0,
    sourceUrl: 'https://ambientcg.com/view?id=Scratches005',
    files: ['tools/blender/weapons/textures/scratches.jpg'],
    notes: 'Opacity map downscaled to 1024 px, used only as a bake input.',
  },
  {
    id: 'weapons-ambientcg-metal009',
    category: 'weapons',
    title: 'Metal009 (brushed steel roughness, bake source for the gun metal)',
    author: 'ambientCG',
    license: 'CC0 1.0',
    licenseUrl: CC0,
    sourceUrl: 'https://ambientcg.com/view?id=Metal009',
    files: ['tools/blender/weapons/textures/brushed_steel_rough.jpg'],
    notes: 'Roughness map downscaled to 1024 px, used only as a bake input.',
  },
  {
    id: 'weapons-ambientcg-plastic012b',
    category: 'weapons',
    title: 'Plastic012B (scratched plastic roughness, bake source for polymer, rubber and matte finishes)',
    author: 'ambientCG',
    license: 'CC0 1.0',
    licenseUrl: CC0,
    sourceUrl: 'https://ambientcg.com/view?id=Plastic012B',
    files: ['tools/blender/weapons/textures/plastic_rough.jpg'],
    notes: 'Roughness map downscaled to 1024 px, used only as a bake input.',
  },
  {
    id: 'audio-deagle-shot',
    category: 'audio',
    title: 'Magnum Research Desert Eagle',
    author: 'areniporgen',
    license: 'CC0 1.0',
    licenseUrl: CC0,
    sourceUrl: 'https://freesound.org/people/areniporgen/sounds/712310/',
    files: ['public/audio/deagle_shot.mp3'],
  },
  {
    id: 'audio-awp-shot',
    category: 'audio',
    title: 'Sniper Shot in Field 3 (M2010 Enhanced Sniper Rifle ESR)',
    author: 'qubodup',
    license: 'CC0 1.0',
    licenseUrl: CC0,
    sourceUrl: 'https://freesound.org/people/qubodup/sounds/855608/',
    files: ['public/audio/awp_shot.mp3'],
  },
  {
    id: 'audio-deagle-reload',
    category: 'audio',
    title: 'PistolReloadSound.wav',
    author: 'MaximBomba',
    license: 'CC0 1.0',
    licenseUrl: CC0,
    sourceUrl: 'https://freesound.org/people/MaximBomba/sounds/432139/',
    files: ['public/audio/deagle_reload.mp3'],
  },
  {
    id: 'audio-awp-reload',
    category: 'audio',
    title: 'Rifle-or-shotgun-reload.wav',
    author: 'MaximBomba',
    license: 'CC0 1.0',
    licenseUrl: CC0,
    sourceUrl: 'https://freesound.org/people/MaximBomba/sounds/432141/',
    files: ['public/audio/awp_reload.mp3'],
  },
  {
    id: 'font-rajdhani',
    category: 'fonts',
    title: 'Rajdhani',
    author: 'Indian Type Foundry',
    license: 'SIL Open Font License 1.1',
    licenseUrl: OFL,
    sourceUrl: 'https://fonts.google.com/specimen/Rajdhani',
    notes: 'Loaded from Google Fonts.',
  },
  {
    id: 'font-space-mono',
    category: 'fonts',
    title: 'Space Mono',
    author: 'Colophon Foundry (The Space Mono Project Authors)',
    license: 'SIL Open Font License 1.1',
    licenseUrl: OFL,
    sourceUrl: 'https://fonts.google.com/specimen/Space+Mono',
    notes: 'Loaded from Google Fonts.',
  },
  {
    id: 'font-barlow-semi-condensed',
    category: 'fonts',
    title: 'Barlow Semi Condensed',
    author: 'Jeremy Tribby (The Barlow Project Authors)',
    license: 'SIL Open Font License 1.1',
    licenseUrl: OFL,
    sourceUrl: 'https://fonts.google.com/specimen/Barlow+Semi+Condensed',
    notes: 'Loaded from Google Fonts. Used for hud numbers and body text because it has tabular figures.',
  },
  {
    id: 'lib-three',
    category: 'software',
    title: 'three.js',
    author: 'mrdoob and contributors',
    license: 'MIT',
    licenseUrl: MIT,
    sourceUrl: 'https://threejs.org/',
  },
  {
    id: 'lib-three-mesh-bvh',
    category: 'software',
    title: 'three-mesh-bvh',
    author: 'Garrett Johnson',
    license: 'MIT',
    licenseUrl: MIT,
    sourceUrl: 'https://github.com/gkjohnson/three-mesh-bvh',
  },
  {
    id: 'lib-idb',
    category: 'software',
    title: 'idb',
    author: 'Jake Archibald',
    license: 'ISC',
    licenseUrl: 'https://opensource.org/license/isc-license-txt',
    sourceUrl: 'https://github.com/jakearchibald/idb',
  },
  {
    id: 'lib-supabase',
    category: 'software',
    title: 'supabase-js',
    author: 'Supabase',
    license: 'MIT',
    licenseUrl: MIT,
    sourceUrl: 'https://github.com/supabase/supabase-js',
  },
  {
    id: 'lib-ws',
    category: 'software',
    title: 'ws',
    author: 'Einar Otto Stangvik and contributors',
    license: 'MIT',
    licenseUrl: MIT,
    sourceUrl: 'https://github.com/websockets/ws',
  },
  {
    id: 'original-knives',
    category: 'original',
    title: 'All 20 procedural knives',
    author: 'WebStrafe',
    license: 'Original work',
    files: ['src/cosmetics/ProceduralKnife.ts', 'src/combat/knives.ts'],
  },
  {
    id: 'original-sfx',
    category: 'original',
    title: 'Procedural sound effects (movement, knife, bolt, slide, confirms, UI)',
    author: 'WebStrafe',
    license: 'Original work',
    files: ['src/audio/ProceduralSfx.ts'],
  },
  {
    id: 'original-ui',
    category: 'original',
    title: 'HUD, menu, crosshair, logo mark and weapon icons',
    author: 'WebStrafe',
    license: 'Original work',
    files: ['src/ui/hud/icons.ts', 'src/ui/brand.ts', 'public/favicon.svg'],
  },
  {
    id: 'original-maps',
    category: 'original',
    title: 'Prismline, Emberdrift, Ochre Cut and the movement test scene (built by our Blender scripts in tools/blender/maps)',
    author: 'WebStrafe',
    license: 'Original work',
    files: [
      'public/maps/surf_prismline/scene.glb',
      'public/maps/bhop_emberdrift/scene.glb',
      'public/maps/aim_ochrecut/scene.glb',
      'public/maps/movement_test_scene/scene.glb',
    ],
  },
  {
    id: 'original-viewmodels',
    category: 'original',
    title: 'First-person arms, wristwatch, Deagle, AWP and katana (built by our Blender scripts in tools/blender)',
    author: 'WebStrafe',
    license: 'Original work',
    files: ['public/viewmodels/v2/arms.glb', 'public/viewmodels/v2/deagle.glb', 'public/viewmodels/v2/awp.glb', 'public/viewmodels/v2/katana.glb'],
  },
  {
    id: 'original-players',
    category: 'original',
    title: 'Procedural player models',
    author: 'WebStrafe',
    license: 'Original work',
    files: ['src/multiplayer/ProceduralPlayer.ts'],
  },
  {
    id: 'original-armor',
    category: 'original',
    title: 'Strafe, Anvil, Vector, Quill and Edge armor sets (built by our Blender scripts in tools/blender/characters)',
    author: 'WebStrafe',
    license: 'Original work',
    files: ['public/characters/armor.glb', 'tools/blender/characters/armor_sets.py', 'tools/blender/characters/edge_set.py'],
  },
  {
    id: 'original-cosmetics',
    category: 'original',
    title: 'Placeholder gloves, knife and textures',
    author: 'WebStrafe',
    license: 'CC0 1.0',
    licenseUrl: CC0,
    files: ['public/cosmetics/models/gloves_placeholder.glb', 'public/cosmetics/models/knife_placeholder.glb'],
  },
];

export function creditsByCategory(entries: readonly CreditEntry[] = CREDITS): Array<[CreditCategory, CreditEntry[]]> {
  return CREDIT_CATEGORY_ORDER
    .map((category) => [category, entries.filter((entry) => entry.category === category)] as [CreditCategory, CreditEntry[]])
    .filter(([, list]) => list.length > 0);
}

export function renderCreditsMarkdown(entries: readonly CreditEntry[] = CREDITS): string {
  const lines: string[] = [
    '# Credits',
    '',
    'Generated from `src/credits.ts` (run `npx tsx tools/generate-credits.ts`). The same',
    'list is shown in the in-game Credits tab. Maps added to `public/maps/manifest.json`',
    'without an entry here are still credited in-game from their manifest fields.',
    '',
    'WebStrafe does not ship Valve or Counter-Strike assets. Anything not listed',
    'below is original WebStrafe work.',
  ];
  for (const [category, list] of creditsByCategory(entries)) {
    lines.push('', `## ${CREDIT_CATEGORY_LABEL[category]}`, '');
    for (const entry of list) {
      const title = entry.sourceUrl ? `[${entry.title}](${entry.sourceUrl})` : entry.title;
      const license = entry.licenseUrl ? `[${entry.license}](${entry.licenseUrl})` : entry.license;
      lines.push(`- ${title} by ${entry.author}. License: ${license}.`);
      if (entry.files && entry.files.length > 0) {
        lines.push(`  Files: ${entry.files.map((file) => `\`${file}\``).join(', ')}.`);
      }
      if (entry.notes) {
        lines.push(`  ${entry.notes}`);
      }
    }
  }
  lines.push('');
  return lines.join('\n');
}
