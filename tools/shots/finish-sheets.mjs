// knife finish contact sheets for docs/screenshots/knives: studio sheets and
// in-hand inspect sheets of every finish on the karambit, m9 bayonet and
// balisong, a wear ladder and seed variations, written as palette pngs.
// needs a running dev server and the capture.mjs env (PLAYWRIGHT_MODULE, CHROME, GPU=1).
//   node tools/shots/finish-sheets.mjs <base url> [out dir]
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const [base, outArg] = process.argv.slice(2);
if (!base) {
  console.error('usage: node tools/shots/finish-sheets.mjs <base url> [out dir]');
  process.exit(1);
}
const out = outArg ?? join(root, 'docs/screenshots/knives');
const tmp = join(tmpdir(), 'webstrafe-finish-sheets');
mkdirSync(out, { recursive: true });
mkdirSync(tmp, { recursive: true });

const FINISHES = {
  vanilla: 'Vanilla', doppler_phase1: 'Doppler (Phase 1)', doppler_phase2: 'Doppler (Phase 2)', doppler_phase3: 'Doppler (Phase 3)',
  doppler_phase4: 'Doppler (Phase 4)', doppler_ruby: 'Doppler (Ruby)', doppler_sapphire: 'Doppler (Sapphire)',
  doppler_black_pearl: 'Doppler (Black Pearl)', doppler_emerald: 'Doppler (Emerald)', marble_fade: 'Marble Fade', fade: 'Fade',
  tiger_tooth: 'Tiger Tooth', slaughter: 'Slaughter', case_hardened: 'Case Hardened', damascus_steel: 'Damascus Steel',
  blue_steel: 'Blue Steel', stained: 'Stained', crimson_web: 'Crimson Web', ultraviolet: 'Ultraviolet', night: 'Night',
  safari_mesh: 'Safari Mesh', boreal_forest: 'Boreal Forest', scorched: 'Scorched',
};
// [seed, wear] showing each finish at its cleanest
const PICK = {
  marble_fade: [1, 0.01], fade: [16, 0.01], slaughter: [12, 0.02], case_hardened: [12, 0.05], damascus_steel: [12, 0.05],
  blue_steel: [12, 0.05], stained: [12, 0.05], crimson_web: [5, 0.07], ultraviolet: [1, 0.07], night: [1, 0.07],
  safari_mesh: [12, 0.1], boreal_forest: [12, 0.1], scorched: [12, 0.1],
};
// inspect clip time where each knife shows its blade
const KNIVES = { karambit: 2.1, m9_bayonet: 1.6, butterfly: 2.8 };
const CELL = [480, 300];
const png = (img) => img.png({ palette: true, quality: 92, effort: 8 });

function capture(width, height, jobs) {
  execFileSync('node', [join(root, 'tools/shots/capture.mjs'), base, tmp, ...jobs], {
    env: { ...process.env, WIDTH: String(width), HEIGHT: String(height) },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

function bar(width, text) {
  return Buffer.from(`<svg width="${width}" height="48"><rect width="100%" height="100%" fill="#0a0d12"/>`
    + `<text x="16" y="32" font-size="24" font-family="Helvetica, Arial" font-weight="700" fill="#ff6a2b">${text}</text></svg>`);
}

/** centre of the finished knife, found from the bright green emerald frame */
async function knifeCentre(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let x0 = Infinity; let y0 = Infinity; let x1 = -1; let y1 = -1;
  for (let y = 0; y < info.height - 40; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const i = (y * info.width + x) * 3;
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
      if (g > 60 && g > r * 1.3 && g > b * 1.05) {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
    }
  }
  if (x1 < 0) return [info.width / 2, info.height / 2];
  return [(x0 + x1) / 2, (y0 + y1) / 2];
}

// studio sheets, wear ladder and seeds
const sheet = (q) => `/tools/knife-finish-sheet.html?width=2400&tilt=0.12&${q}`;
const wear = [['m9_bayonet', 'crimson_web', 5], ['m9_bayonet', 'boreal_forest', 12], ['karambit', 'night', 12],
  ['butterfly', 'safari_mesh', 12], ['karambit', 'case_hardened', 12]];
const seeds = [['karambit', 'case_hardened', '387,661,45,2,0,98', 0], ['m9_bayonet', 'marble_fade', '31,36,9,11,1,0', 0],
  ['m9_bayonet', 'crimson_web', '5,14,0,48,2,3', 0.07], ['karambit', 'fade', '16,103,40,80,6,11', 0],
  ['butterfly', 'doppler_phase2', '1,2,3,4,5,6', 0]];
capture(2400, 1334, [
  ...Object.keys(KNIVES).map((k) => `${sheet(`knife=${k}&seed=12`)}=sheet_${k}.png`),
  ...wear.map(([k, f, s]) => `${sheet(`knife=${k}&mode=wear&finish=${f}&seed=${s}&cols=5`)}=wear_${f}.png`),
  ...seeds.map(([k, f, s, w]) => `${sheet(`knife=${k}&mode=seeds&finish=${f}&seeds=${s}&wear=${w}&cols=6`)}=seeds_${f}.png`),
]);
for (const knife of Object.keys(KNIVES)) {
  const img = sharp(join(tmp, `sheet_${knife}.png`));
  const meta = await img.metadata();
  await png(sharp({ create: { width: meta.width, height: meta.height + 48, channels: 3, background: '#14181f' } }).composite([
    { input: bar(meta.width, `${knife}: every finish, studio light (cleanest float, pattern 12)`), left: 0, top: 0 },
    { input: await img.toBuffer(), left: 0, top: 48 },
  ])).toFile(join(out, `finishes_sheet_${knife}.png`));
}
async function stack(files, rowH, title, name) {
  const comps = [{ input: bar(2400, title), left: 0, top: 0 }];
  for (let i = 0; i < files.length; i += 1) {
    comps.push({ input: await sharp(join(tmp, files[i])).extract({ left: 0, top: 0, width: 2400, height: rowH }).toBuffer(), left: 0, top: 48 + i * rowH });
  }
  await png(sharp({ create: { width: 2400, height: 48 + files.length * rowH, channels: 3, background: '#14181f' } }).composite(comps))
    .toFile(join(out, name));
}
await stack(wear.map(([, f]) => `wear_${f}.png`), 267,
  'wear: FN 0.02, MW 0.10, FT 0.26, WW 0.41, BS 0.75 (clamped to each finish float range)', 'finishes_wear.png');
await stack(seeds.map(([, f]) => `seeds_${f}.png`), 222,
  'pattern seeds: case hardened blue gems to gold, marble fade fire and ice, web hubs, fade %, doppler placement', 'finishes_seeds.png');

// in hand, the viewmodel inspect pose
const ids = Object.keys(FINISHES);
for (const [knife, t] of Object.entries(KNIVES)) {
  capture(1600, 900, ids.map((id) => {
    const [seed, w] = PICK[id] ?? [3, 0.01];
    return `/tools/viewmodel-preview.html?item=knife&knife=${knife}&finish=${id}&wear=${w}&seed=${seed}&clip=inspect&t=${t}&width=1600=ih_${knife}_${id}.png`;
  }));
  const [cx, cy] = await knifeCentre(join(tmp, `ih_${knife}_doppler_emerald.png`));
  const left = Math.round(Math.min(1600 - CELL[0], Math.max(0, cx - CELL[0] / 2)));
  const top = Math.round(Math.min(900 - CELL[1], Math.max(0, cy - CELL[1] / 2)));
  const cols = 5;
  const rows = Math.ceil(ids.length / cols);
  const comps = [{ input: bar(cols * CELL[0], `${knife} in hand, inspect pose (procedural finishes, cleanest float)`), left: 0, top: 0 }];
  for (let i = 0; i < ids.length; i += 1) {
    const x = (i % cols) * CELL[0];
    const y = 48 + Math.floor(i / cols) * CELL[1];
    comps.push({ input: await sharp(join(tmp, `ih_${knife}_${ids[i]}.png`)).extract({ left, top, width: CELL[0], height: CELL[1] }).toBuffer(), left: x, top: y });
    const label = Buffer.from(`<svg width="${CELL[0]}" height="34"><rect width="100%" height="100%" fill="#0a0d12" opacity="0.72"/>`
      + `<text x="12" y="23" font-size="19" font-family="Helvetica, Arial" font-weight="600" fill="#f2f4f8">${FINISHES[ids[i]]}</text></svg>`);
    comps.push({ input: label, left: x, top: y });
  }
  await png(sharp({ create: { width: cols * CELL[0], height: 48 + rows * CELL[1], channels: 3, background: '#2a3038' } }).composite(comps))
    .toFile(join(out, `finishes_inhand_${knife}.png`));
}
console.log(`finish sheets written to ${out}`);
