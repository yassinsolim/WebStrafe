// downloads a sketchfab model as glb with your api token and writes its license
// next to it, for CREDITS.md. only CC-BY and CC0 models are accepted.
//   node tools/assets/sketchfab-fetch.mjs <model uid> [out dir]
// the token is read from SKETCHFAB_TOKEN_FILE or ~/.config/webstrafe/sketchfab-token.txt
// and is never printed. raw downloads stay out of the repo (default ~/Assets/webstrafe/sketchfab).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const [uid, outArg] = process.argv.slice(2);
if (!uid || !/^[0-9a-f]{32}$/.test(uid)) {
  console.error('usage: node tools/assets/sketchfab-fetch.mjs <32 hex model uid> [out dir]');
  process.exit(1);
}
const tokenFile = process.env.SKETCHFAB_TOKEN_FILE ?? path.join(homedir(), '.config/webstrafe/sketchfab-token.txt');
let token;
try {
  token = readFileSync(tokenFile, 'utf8').trim();
} catch {
  console.error(`no token at ${tokenFile}: create one at https://sketchfab.com/settings/password and save it there`);
  process.exit(1);
}

const api = 'https://api.sketchfab.com/v3';
const info = await (await fetch(`${api}/models/${uid}`)).json();
const license = info.license?.label ?? '';
if (license !== 'CC Attribution' && !/CC0|Public Domain/.test(license)) {
  console.error(`refusing "${info.name}": license is ${license || 'unknown'}, only CC-BY and CC0 can ship`);
  process.exit(1);
}
const res = await fetch(`${api}/models/${uid}/download`, { headers: { Authorization: `Token ${token}` } });
if (!res.ok) {
  console.error(`download request failed: ${res.status} ${res.statusText}`);
  process.exit(1);
}
const links = await res.json();
const pick = links.glb ?? links.gltf;
if (!pick?.url) {
  console.error('no glb or gltf archive offered for this model');
  process.exit(1);
}
const slug = info.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || uid;
const outDir = path.resolve(outArg ?? path.join(homedir(), 'Assets/webstrafe/sketchfab', slug));
mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, links.glb ? `${slug}.glb` : `${slug}.zip`);
const data = Buffer.from(await (await fetch(pick.url)).arrayBuffer());
writeFileSync(file, data);
writeFileSync(path.join(outDir, 'license.json'), `${JSON.stringify({
  uid,
  name: info.name,
  author: info.user?.displayName ?? info.user?.username,
  authorUrl: info.user?.profileUrl,
  url: info.viewerUrl,
  license,
  licenseUrl: info.license?.url,
  downloadedAt: new Date().toISOString(),
}, null, 2)}\n`);
console.log(`${info.name} by ${info.user?.displayName} (${license}) -> ${file} (${(data.length / 1024 / 1024).toFixed(1)} MB)`);
