import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';

type Obj2GltfFn = (input: string, options?: { binary?: boolean }) => Promise<Buffer | ArrayBuffer>;

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicMapsDir = path.join(rootDir, 'public', 'maps');

const program = new Command();
program
  .name('convert-map')
  .requiredOption('--input <path>', 'Input map file (.bsp, .obj, .glb, .gltf) or extracted folder')
  .requiredOption('--name <mapname>', 'Output map id / folder name')
  .option('--collision <path>', 'Optional collision source if separate from scene')
  .option('--author <name>', 'Map author', 'Unknown')
  .option('--source <url>', 'Map source URL', 'https://github.com/OuiSURF/Surf_Maps')
  .option('--license <text>', 'Map license text', 'Unspecified by author')
  .option('--spawn <x,y,z,yaw>', 'Fallback spawn as CSV (yaw optional)', '0,4,0,0')
  .option('--attribution <text>', 'Attribution text for metadata', '');

async function main(): Promise<void> {
  program.parse(process.argv);
  const options = program.opts<{
    input: string;
    name: string;
    collision?: string;
    author: string;
    source: string;
    license: string;
    spawn: string;
    attribution: string;
  }>();

  const inputPath = path.resolve(options.input);
  const outputDir = path.join(publicMapsDir, options.name);
  await fs.mkdir(outputDir, { recursive: true });

  const sceneGlbPath = path.join(outputDir, 'scene.glb');
  const collisionGlbPath = path.join(outputDir, 'collision.glb');
  const metaPath = path.join(outputDir, 'meta.json');

  const sceneSource = await resolveSceneSource(inputPath, options.name);
  await convertToGlb(sceneSource, sceneGlbPath);

  if (options.collision) {
    const collisionSourcePath = await resolveSceneSource(path.resolve(options.collision), `${options.name}_collision`);
    await convertToGlb(collisionSourcePath, collisionGlbPath);
  } else {
    await fs.copyFile(sceneGlbPath, collisionGlbPath);
  }

  const spawn = parseSpawn(options.spawn);
  const meta = {
    id: options.name,
    name: options.name,
    author: options.author,
    source: options.source,
    license: options.license,
    attribution: options.attribution,
    spawns: [
      {
        position: [spawn.x, spawn.y, spawn.z],
        yawDeg: spawn.yaw,
      },
    ],
  };
  await fs.writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

  await upsertManifestEntry({
    id: options.name,
    name: options.name,
    author: options.author,
    source: options.source,
    license: options.license,
    scenePath: `/maps/${options.name}/scene.glb`,
    collisionPath: `/maps/${options.name}/collision.glb`,
    metaPath: `/maps/${options.name}/meta.json`,
  });

  // eslint-disable-next-line no-console
  console.log(`Converted map "${options.name}" -> public/maps/${options.name}`);
}

async function resolveSceneSource(inputPath: string, outputName: string): Promise<string> {
  const stat = await fs.stat(inputPath);
  if (stat.isDirectory()) {
    const preferred = await findFirstByExt(inputPath, ['.glb', '.gltf', '.obj', '.bsp']);
    if (!preferred) {
      throw new Error(`No supported scene source found under directory: ${inputPath}`);
    }
    return resolveSceneSource(preferred, outputName);
  }

  const ext = path.extname(inputPath).toLowerCase();
  if (ext === '.bsp') {
    return convertBspToObj(inputPath, outputName);
  }
  return inputPath;
}

async function convertToGlb(sourcePath: string, targetGlbPath: string): Promise<void> {
  const ext = path.extname(sourcePath).toLowerCase();
  if (ext === '.glb') {
    await fs.copyFile(sourcePath, targetGlbPath);
    return;
  }
  if (ext === '.obj') {
    await convertObjToGlb(sourcePath, targetGlbPath);
    return;
  }
  if (ext === '.gltf') {
    const gltfPipeline = (await import('gltf-pipeline')) as {
      gltfToGlb: (gltf: unknown, options: { resourceDirectory: string; separate: boolean }) => Promise<{
        glb: Uint8Array;
      }>;
    };
    const gltfJson = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
    const { glb } = await gltfPipeline.gltfToGlb(gltfJson, {
      resourceDirectory: path.dirname(sourcePath),
      separate: false,
    });
    await fs.writeFile(targetGlbPath, glb);
    return;
  }
  throw new Error(`Unsupported source for GLB conversion: ${sourcePath}`);
}

async function convertObjToGlb(objPath: string, outGlbPath: string): Promise<void> {
  const mod = await import('obj2gltf');
  const obj2gltf = (mod.default ?? mod) as Obj2GltfFn;
  const glb = await obj2gltf(objPath, { binary: true });
  const buffer = Buffer.isBuffer(glb) ? glb : Buffer.from(glb);
  await fs.writeFile(outGlbPath, buffer);
}

async function convertBspToObj(bspPath: string, outputName: string): Promise<string> {
  const converterTemplate = process.env.WEBSTRAFE_BSP_TO_OBJ_CMD;
  if (!converterTemplate) {
    throw new Error(
      [
        'BSP input detected but WEBSTRAFE_BSP_TO_OBJ_CMD is not configured.',
        'Set WEBSTRAFE_BSP_TO_OBJ_CMD to a command template using {input} and {outputObj}.',
        'Example (with a custom converter wrapper):',
        '  set WEBSTRAFE_BSP_TO_OBJ_CMD=node tools/bsp-wrapper.js --in {input} --out {outputObj}',
      ].join('\n'),
    );
  }

  const outputObj = path.join(rootDir, '.cache', `${outputName}.obj`);
  await fs.mkdir(path.dirname(outputObj), { recursive: true });
  const command = converterTemplate
    .replaceAll('{input}', quoteShellArg(bspPath))
    .replaceAll('{outputObj}', quoteShellArg(outputObj));

  await runShell(command);
  await fs.access(outputObj);
  return outputObj;
}

async function upsertManifestEntry(entry: Record<string, string>): Promise<void> {
  await fs.mkdir(publicMapsDir, { recursive: true });
  const manifestPath = path.join(publicMapsDir, 'manifest.json');

  let manifest: { maps: Array<Record<string, string>> } = { maps: [] };
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as {
      maps: Array<Record<string, string>>;
    };
  } catch {
    manifest = { maps: [] };
  }

  const next = manifest.maps.filter((map) => map.id !== entry.id);
  next.push(entry);
  next.sort((a, b) => a.id.localeCompare(b.id));
  manifest.maps = next;

  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

async function findFirstByExt(dir: string, extensions: string[]): Promise<string | null> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(dir, entry.name));

  for (const ext of extensions) {
    const match = files.find((file) => file.toLowerCase().endsWith(ext));
    if (match) {
      return match;
    }
  }

  for (const child of entries.filter((entry) => entry.isDirectory())) {
    const hit = await findFirstByExt(path.join(dir, child.name), extensions);
    if (hit) {
      return hit;
    }
  }
  return null;
}

function parseSpawn(raw: string): { x: number; y: number; z: number; yaw: number } {
  const [x, y, z, yaw = '0'] = raw.split(',').map((item) => item.trim());
  const parsed = [Number(x), Number(y), Number(z), Number(yaw)];
  if (parsed.some((value) => Number.isNaN(value))) {
    throw new Error(`Invalid --spawn value: "${raw}"`);
  }
  return {
    x: parsed[0],
    y: parsed[1],
    z: parsed[2],
    yaw: parsed[3],
  };
}

async function runShell(command: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      stdio: 'inherit',
    });
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`External converter command failed with code ${code}.`));
      }
    });
    child.on('error', reject);
  });
}

function quoteShellArg(value: string): string {
  if (process.platform === 'win32') {
    return `"${value.replaceAll('"', '\\"')}"`;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

void main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
