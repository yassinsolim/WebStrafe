import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

type Obj2GltfFn = (input: string, options?: { binary?: boolean }) => Promise<Buffer | ArrayBuffer>;

interface SampleMapSpec {
  id: string;
  name: string;
  author: string;
  source: string;
  license: string;
  obj: string;
  spawn: [number, number, number];
  yawDeg: number;
  attribution: string;
}

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(rootDir, 'public');
const tempDir = path.join(rootDir, '.cache');

async function main(): Promise<void> {
  await fs.mkdir(tempDir, { recursive: true });
  await generateSampleMaps();
  await generateCosmeticsAssets();
}

async function generateSampleMaps(): Promise<void> {
  const mapSpecs: SampleMapSpec[] = [
    {
      id: 'movement_test_scene',
      name: 'Movement Test Scene',
      author: 'WebStrafe Team',
      source: 'https://github.com/OuiSURF/Surf_Maps',
      license: 'Original placeholder training geometry',
      obj: buildMovementTestObj(),
      spawn: [0, 4, 16],
      yawDeg: 0,
      attribution: 'Original geometry shipped with WebStrafe for movement acceptance diagnostics.',
    },
    {
      id: 'training_straight',
      name: 'Training Straight',
      author: 'WebStrafe Team',
      source: 'https://github.com/OuiSURF/Surf_Maps',
      license: 'Original placeholder training geometry',
      obj: buildStraightTrainingObj(),
      spawn: [0, 4, 14],
      yawDeg: 0,
      attribution: 'Original geometry shipped with WebStrafe for legal-safe placeholder testing.',
    },
    {
      id: 'training_switchback',
      name: 'Training Switchback',
      author: 'WebStrafe Team',
      source: 'https://github.com/OuiSURF/Surf_Maps',
      license: 'Original placeholder training geometry',
      obj: buildSwitchbackTrainingObj(),
      spawn: [0, 6, 20],
      yawDeg: 180,
      attribution: 'Original geometry shipped with WebStrafe for legal-safe placeholder testing.',
    },
  ];

  const manifestMaps: Array<Record<string, string>> = [];

  for (const mapSpec of mapSpecs) {
    const mapDir = path.join(publicDir, 'maps', mapSpec.id);
    await fs.mkdir(mapDir, { recursive: true });

    const objPath = path.join(tempDir, `${mapSpec.id}.obj`);
    const sceneGlbPath = path.join(mapDir, 'scene.glb');
    const collisionGlbPath = path.join(mapDir, 'collision.glb');
    const metaPath = path.join(mapDir, 'meta.json');

    await fs.writeFile(objPath, mapSpec.obj, 'utf8');
    await convertObjToGlb(objPath, sceneGlbPath);
    await fs.copyFile(sceneGlbPath, collisionGlbPath);

    const meta = {
      id: mapSpec.id,
      name: mapSpec.name,
      author: mapSpec.author,
      source: mapSpec.source,
      license: mapSpec.license,
      attribution: mapSpec.attribution,
      spawns: [
        {
          position: mapSpec.spawn,
          yawDeg: mapSpec.yawDeg,
        },
      ],
    };
    await fs.writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

    manifestMaps.push({
      id: mapSpec.id,
      name: mapSpec.name,
      author: mapSpec.author,
      source: mapSpec.source,
      license: mapSpec.license,
      scenePath: `/maps/${mapSpec.id}/scene.glb`,
      collisionPath: `/maps/${mapSpec.id}/collision.glb`,
      metaPath: `/maps/${mapSpec.id}/meta.json`,
    });
  }

  const manifestPath = path.join(publicDir, 'maps', 'manifest.json');
  const existing = await readJsonFile<{ maps?: Array<Record<string, string>> }>(manifestPath);
  const generatedIds = new Set(manifestMaps.map((map) => map.id));
  const preservedMaps = (existing.maps ?? []).filter((map) => !generatedIds.has(map.id ?? ''));

  const manifest = {
    maps: [...preservedMaps, ...manifestMaps],
  };
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

async function generateCosmeticsAssets(): Promise<void> {
  const modelsDir = path.join(publicDir, 'cosmetics', 'models');
  const texturesDir = path.join(publicDir, 'cosmetics', 'textures');
  await fs.mkdir(modelsDir, { recursive: true });
  await fs.mkdir(texturesDir, { recursive: true });

  const gloveObjPath = path.join(tempDir, 'gloves_placeholder.obj');
  const knifeObjPath = path.join(tempDir, 'knife_placeholder.obj');
  const gloveGlbPath = path.join(modelsDir, 'gloves_placeholder.glb');
  const knifeGlbPath = path.join(modelsDir, 'knife_placeholder.glb');

  await fs.writeFile(gloveObjPath, buildGlovesObj(), 'utf8');
  await fs.writeFile(knifeObjPath, buildKnifeObj(), 'utf8');
  await convertObjToGlb(gloveObjPath, gloveGlbPath);
  await convertObjToGlb(knifeObjPath, knifeGlbPath);

  await writeSolidPng(path.join(texturesDir, 'base_teal.png'), 60, 176, 166, 255);
  await writeSolidPng(path.join(texturesDir, 'base_sand.png'), 192, 150, 94, 255);
  await writeSolidPng(path.join(texturesDir, 'base_steel.png'), 188, 193, 204, 255);
  await writeSolidPng(path.join(texturesDir, 'base_ember.png'), 186, 88, 39, 255);
  await writeSolidPng(path.join(texturesDir, 'normal_flat.png'), 128, 128, 255, 255);
  await writeSolidPng(path.join(texturesDir, 'rough_metal.png'), 120, 120, 120, 255);
  await writeSolidPng(path.join(texturesDir, 'ao_full.png'), 255, 255, 255, 255);

  const manifestPath = path.join(publicDir, 'cosmetics', 'manifest.json');
  const generatedManifest = {
    gloves: [
      {
        id: 'utility_gloves',
        name: 'Utility Gloves',
        author: 'WebStrafe Team',
        license: 'CC0',
        source: 'Original model',
        modelPath: '/cosmetics/models/gloves_placeholder.glb',
        variants: [
          {
            id: 'teal_mesh',
            name: 'Teal Mesh',
            rarity: 'common',
            thumbnail: '/cosmetics/textures/base_teal.png',
            textures: {
              baseColor: '/cosmetics/textures/base_teal.png',
              normal: '/cosmetics/textures/normal_flat.png',
              roughnessMetal: '/cosmetics/textures/rough_metal.png',
              ao: '/cosmetics/textures/ao_full.png',
            },
            wear: 0.12,
            patternSeed: 14,
            patternScale: 1.2,
            hueShift: 0,
          },
          {
            id: 'sand_weave',
            name: 'Sand Weave',
            rarity: 'rare',
            thumbnail: '/cosmetics/textures/base_sand.png',
            textures: {
              baseColor: '/cosmetics/textures/base_sand.png',
              normal: '/cosmetics/textures/normal_flat.png',
              roughnessMetal: '/cosmetics/textures/rough_metal.png',
              ao: '/cosmetics/textures/ao_full.png',
            },
            wear: 0.2,
            patternSeed: 87,
            patternScale: 1,
            hueShift: 0.08,
          },
        ],
      },
    ],
    knives: [
      {
        id: 'trainer_knife',
        name: 'Trainer Knife',
        author: 'WebStrafe Team',
        license: 'CC0',
        source: 'Original model',
        modelPath: '/cosmetics/models/knife_placeholder.glb',
        variants: [
          {
            id: 'steel_blue',
            name: 'Steel Blue',
            rarity: 'common',
            thumbnail: '/cosmetics/textures/base_steel.png',
            textures: {
              baseColor: '/cosmetics/textures/base_steel.png',
              normal: '/cosmetics/textures/normal_flat.png',
              roughnessMetal: '/cosmetics/textures/rough_metal.png',
              ao: '/cosmetics/textures/ao_full.png',
            },
            wear: 0.1,
            patternSeed: 21,
            patternScale: 1.1,
            hueShift: -0.08,
          },
          {
            id: 'ember_fade',
            name: 'Ember Fade',
            rarity: 'legendary',
            thumbnail: '/cosmetics/textures/base_ember.png',
            textures: {
              baseColor: '/cosmetics/textures/base_ember.png',
              normal: '/cosmetics/textures/normal_flat.png',
              roughnessMetal: '/cosmetics/textures/rough_metal.png',
              ao: '/cosmetics/textures/ao_full.png',
            },
            wear: 0.18,
            patternSeed: 222,
            patternScale: 1.6,
            hueShift: 0.17,
          },
        ],
      },
    ],
  };

  const existing = await readJsonFile<{
    gloves?: Array<Record<string, unknown>>;
    knives?: Array<Record<string, unknown>>;
  }>(manifestPath);

  const generatedGloveIds = new Set(generatedManifest.gloves.map((item) => item.id));
  const generatedKnifeIds = new Set(generatedManifest.knives.map((item) => item.id));
  const preservedGloves = (existing.gloves ?? []).filter((item) => !generatedGloveIds.has(String(item.id ?? '')));
  const preservedKnives = (existing.knives ?? []).filter((item) => !generatedKnifeIds.has(String(item.id ?? '')));

  const manifest = {
    gloves: [...preservedGloves, ...generatedManifest.gloves],
    knives: [...preservedKnives, ...generatedManifest.knives],
  };
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

async function convertObjToGlb(objPath: string, outGlbPath: string): Promise<void> {
  const mod = await import('obj2gltf');
  const obj2gltf = (mod.default ?? mod) as Obj2GltfFn;
  const result = await obj2gltf(objPath, { binary: true });
  const buffer = Buffer.isBuffer(result) ? result : Buffer.from(result);
  await fs.writeFile(outGlbPath, buffer);
}

async function writeSolidPng(
  outputPath: string,
  r: number,
  g: number,
  b: number,
  a: number,
): Promise<void> {
  const png = new PNG({ width: 2, height: 2 });
  for (let i = 0; i < png.width * png.height; i += 1) {
    const idx = i * 4;
    png.data[idx + 0] = r;
    png.data[idx + 1] = g;
    png.data[idx + 2] = b;
    png.data[idx + 3] = a;
  }
  await fs.writeFile(outputPath, PNG.sync.write(png));
}

function buildStraightTrainingObj(): string {
  return [
    '# training_straight',
    'o floor',
    quad([-40, 0, -40], [40, 0, -40], [40, 0, 40], [-40, 0, 40], 1),
    'o ramp_a',
    quad([-8, 11, -8], [1, -2.2, -8], [1, -2.2, 8], [-8, 11, 8], 5),
    'o ramp_b',
    quad([7, -2.2, -8], [16, 11, -8], [16, 11, 8], [7, -2.2, 8], 9),
    'o platform',
    quad([-4, 7, -16], [4, 7, -16], [4, 7, -8], [-4, 7, -8], 13),
  ].join('\n');
}

function buildSwitchbackTrainingObj(): string {
  return [
    '# training_switchback',
    'o floor',
    quad([-50, 0, -50], [50, 0, -50], [50, 0, 50], [-50, 0, 50], 1),
    'o ramp_left',
    quad([-24, 12, -5], [-14, -2, -5], [-14, -2, 9], [-24, 12, 9], 5),
    'o ramp_right',
    quad([14, -2, -11], [24, 12, -11], [24, 12, 3], [14, -2, 3], 9),
    'o center_ramp',
    quad([-4, 9, 20], [8, -4, 20], [8, -4, 32], [-4, 9, 32], 13),
  ].join('\n');
}

function buildMovementTestObj(): string {
  return [
    '# movement_test_scene',
    'o floor',
    quad([-45, 0, -45], [45, 0, -45], [45, 0, 45], [-45, 0, 45], 1),
    'o surf_left',
    quad([-26, 14, -14], [-16, -3, -14], [-16, -3, 6], [-26, 14, 6], 5),
    'o surf_right',
    quad([16, -3, 8], [26, 14, 8], [26, 14, 28], [16, -3, 28], 9),
    'o jump_pad',
    quad([-6, 4, -28], [6, 4, -28], [6, 4, -16], [-6, 4, -16], 13),
  ].join('\n');
}

function buildGlovesObj(): string {
  return [
    '# gloves_placeholder',
    'o left_glove',
    cuboid(-0.45, -0.15, -0.4, -0.05, 0.15, 0.6, 1),
    'o right_glove',
    cuboid(0.05, -0.15, -0.4, 0.45, 0.15, 0.6, 9),
  ].join('\n');
}

function buildKnifeObj(): string {
  return [
    '# knife_placeholder',
    'o handle',
    cuboid(-0.06, -0.05, -0.45, 0.06, 0.05, -0.05, 1),
    'o blade',
    prismBlade(-0.02, -0.01, -0.05, 0.02, 0.01, 0.52, 9),
  ].join('\n');
}

function quad(
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
  d: [number, number, number],
  indexStart: number,
): string {
  return [
    `v ${a[0]} ${a[1]} ${a[2]}`,
    `v ${b[0]} ${b[1]} ${b[2]}`,
    `v ${c[0]} ${c[1]} ${c[2]}`,
    `v ${d[0]} ${d[1]} ${d[2]}`,
    `f ${indexStart} ${indexStart + 1} ${indexStart + 2}`,
    `f ${indexStart} ${indexStart + 2} ${indexStart + 3}`,
    `f ${indexStart + 2} ${indexStart + 1} ${indexStart}`,
    `f ${indexStart + 3} ${indexStart + 2} ${indexStart}`,
  ].join('\n');
}

function cuboid(
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
  indexStart: number,
): string {
  const v = [
    [minX, minY, minZ],
    [maxX, minY, minZ],
    [maxX, maxY, minZ],
    [minX, maxY, minZ],
    [minX, minY, maxZ],
    [maxX, minY, maxZ],
    [maxX, maxY, maxZ],
    [minX, maxY, maxZ],
  ] as const;
  return [
    ...v.map((p) => `v ${p[0]} ${p[1]} ${p[2]}`),
    `f ${indexStart} ${indexStart + 1} ${indexStart + 2}`,
    `f ${indexStart} ${indexStart + 2} ${indexStart + 3}`,
    `f ${indexStart + 4} ${indexStart + 6} ${indexStart + 5}`,
    `f ${indexStart + 4} ${indexStart + 7} ${indexStart + 6}`,
    `f ${indexStart} ${indexStart + 4} ${indexStart + 5}`,
    `f ${indexStart} ${indexStart + 5} ${indexStart + 1}`,
    `f ${indexStart + 1} ${indexStart + 5} ${indexStart + 6}`,
    `f ${indexStart + 1} ${indexStart + 6} ${indexStart + 2}`,
    `f ${indexStart + 2} ${indexStart + 6} ${indexStart + 7}`,
    `f ${indexStart + 2} ${indexStart + 7} ${indexStart + 3}`,
    `f ${indexStart + 3} ${indexStart + 7} ${indexStart + 4}`,
    `f ${indexStart + 3} ${indexStart + 4} ${indexStart}`,
  ].join('\n');
}

function prismBlade(
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
  indexStart: number,
): string {
  const midY = (minY + maxY) * 0.5;
  const v = [
    [minX, minY, minZ],
    [maxX, minY, minZ],
    [maxX, maxY, minZ],
    [minX, maxY, minZ],
    [0, midY, maxZ],
  ] as const;
  return [
    ...v.map((p) => `v ${p[0]} ${p[1]} ${p[2]}`),
    `f ${indexStart} ${indexStart + 1} ${indexStart + 2}`,
    `f ${indexStart} ${indexStart + 2} ${indexStart + 3}`,
    `f ${indexStart} ${indexStart + 4} ${indexStart + 1}`,
    `f ${indexStart + 1} ${indexStart + 4} ${indexStart + 2}`,
    `f ${indexStart + 2} ${indexStart + 4} ${indexStart + 3}`,
    `f ${indexStart + 3} ${indexStart + 4} ${indexStart}`,
  ].join('\n');
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return {} as T;
  }
}

void main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
