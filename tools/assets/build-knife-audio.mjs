import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cache = path.resolve(process.argv[2] ?? path.join(tmpdir(), 'webstrafe-knife-foley'));
const output = path.join(root, 'public/audio/knife');
const sampleRate = 44100;
const license = 'https://creativecommons.org/publicdomain/zero/1.0/';
const sources = [
  { id: 485266, owner: 9961300, author: 'Joao_Janz', title: 'Knife Swing 1_4' },
  { id: 485265, owner: 9961300, author: 'Joao_Janz', title: 'Knife Swing 1_5' },
  { id: 485269, owner: 9961300, author: 'Joao_Janz', title: 'Knife Swing 1_7' },
  { id: 853769, owner: 17983805, author: 'funkyboiii123', title: 'Butterfly Knife' },
  { id: 321811, owner: 5501856, author: 'mmasonghi', title: 'Pocket Knife Opening' },
  { id: 528710, owner: 6303715, author: 'Rolly-SFX', title: 'SW604 Knife Flick' },
  { id: 329358, owner: 3046293, author: 'bassoonrckr', title: 'Knife on Jeans.wav' },
  { id: 524215, owner: 11537497, author: 'magnuswaker', title: 'Schwing 1' },
  { id: 870740, owner: 18412227, author: 'CHallSmith', title: 'Knife Stabs into Foam Block' },
  { id: 434338, owner: 6599148, author: 'draftcraft', title: 'Knife scrape and hit' },
  { id: 411742, owner: 921610, author: 'neilsher', title: 'Knife Stab Pull.wav' },
];

function decode(file, filters = 'anull') {
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-af', filters, '-ac', '1', '-ar', String(sampleRate), '-f', 'f32le', 'pipe:1'], { maxBuffer: 32 * 1024 * 1024 });
  return Float32Array.from({ length: pcm.length / 4 }, (_, index) => pcm.readFloatLE(index * 4));
}

function measure(samples) {
  const window = Math.round(sampleRate * 0.005);
  let energy = 0;
  let peakEnergy = 0;
  let peakIndex = 0;
  let peak = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    if (!Number.isFinite(sample)) throw new Error('Non-finite audio sample');
    peak = Math.max(peak, Math.abs(sample));
    energy += sample * sample;
    if (index >= window) energy -= samples[index - window] ** 2;
    if (energy > peakEnergy) {
      peakEnergy = energy;
      peakIndex = Math.max(0, index - Math.floor(window / 2));
    }
  }
  return { peak, peakIndex, rms: Math.sqrt(peakEnergy / window) };
}

function render(source, spec) {
  const rate = spec.rate ?? 1;
  const trim = `atrim=start=${spec.start ?? 0}${spec.end === undefined ? '' : `:end=${spec.end}`}`;
  const samples = decode(path.join(cache, `${source.id}.mp3`), `${trim},asetpts=PTS-STARTPTS,aresample=${sampleRate},asetrate=${Math.round(sampleRate * rate)},aresample=${sampleRate},highpass=f=${spec.highpass ?? 55},lowpass=f=${spec.lowpass ?? 12500}`);
  const measured = measure(samples);
  if (measured.rms < 1e-5) throw new Error(`Silent source: ${source.id}`);
  const gain = Math.min(10 ** (spec.rmsDb / 20) / measured.rms, 10 ** (-4 / 20) / measured.peak);
  const shift = Math.round(spec.peakAt * sampleRate) - measured.peakIndex;
  const length = Math.round(spec.duration * sampleRate);
  const pcm = Buffer.alloc(length * 4);
  const fadeIn = sampleRate * 0.003;
  const fadeOut = sampleRate * 0.03;
  for (let index = 0; index < length; index += 1) {
    const sample = samples[index - shift] ?? 0;
    const fade = Math.min(1, index / fadeIn, (length - 1 - index) / fadeOut);
    pcm.writeFloatLE(sample * gain * fade, index * 4);
  }
  const file = path.join(output, `${spec.name}.mp3`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(sampleRate), '-ac', '1', '-i', 'pipe:0', '-c:a', 'libmp3lame', '-b:a', '128k', '-metadata', `artist=${source.author}`, '-metadata', `license=${license}`, file], { input: pcm });
  const encoded = decode(file);
  const result = measure(encoded);
  if (result.peak >= 0.95 || Math.abs(result.peakIndex / sampleRate - spec.peakAt) > 0.012) throw new Error(`Invalid rendered peak: ${spec.name}`);
  return {
    file: `public/audio/knife/${spec.name}.mp3`,
    sourceId: source.id,
    duration: encoded.length / sampleRate,
    peakAt: result.peakIndex / sampleRate,
    peakRmsDb: 20 * Math.log10(result.rms),
    sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
  };
}

mkdirSync(cache, { recursive: true });
mkdirSync(output, { recursive: true });
const provenance = [];
for (const source of sources) {
  const sourceUrl = `https://freesound.org/people/${source.author}/sounds/${source.id}/`;
  const pageFile = path.join(cache, `${source.id}-source.html`);
  if (!existsSync(pageFile)) {
    const response = await fetch(sourceUrl);
    if (!response.ok) throw new Error(`Source ${source.id}: ${response.status}`);
    writeFileSync(pageFile, await response.text());
  }
  if (!readFileSync(pageFile, 'utf8').includes('creativecommons.org/publicdomain/zero/1.0')) throw new Error(`CC0 not verified: ${sourceUrl}`);
  const preview = `https://cdn.freesound.org/previews/${Math.floor(source.id / 1000)}/${source.id}_${source.owner}-hq.mp3`;
  const file = path.join(cache, `${source.id}.mp3`);
  if (!existsSync(file)) {
    const response = await fetch(preview);
    if (!response.ok) throw new Error(`Preview ${source.id}: ${response.status}`);
    writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  }
  provenance.push({ ...source, sourceUrl, preview, license, sha256: createHash('sha256').update(readFileSync(file)).digest('hex') });
}

const clips = [];
for (const [index, source] of sources.slice(0, 3).entries()) {
  clips.push(render(source, { name: `slash-${index + 1}`, rate: 1, peakAt: 0.07, duration: 0.34, rmsDb: -19 }));
  clips.push(render(source, { name: `stab-${index + 1}`, rate: 0.9, peakAt: 0.09, duration: 0.42, rmsDb: -17 }));
  clips.push(render(source, { name: `flick-${index + 1}`, rate: 1.2, peakAt: 0.04, duration: 0.18, rmsDb: -29, highpass: 700 }));
}

function takes(prefix, sourceId, windows, spec) {
  const source = sources.find(source => source.id === sourceId);
  for (const [index, [start, end]] of windows.entries()) {
    clips.push(render(source, { ...spec, name: `${prefix}-${index + 1}`, start, end }));
  }
}

takes('cloth', 329358, [[0, 0.23], [0.53, 0.76]], { peakAt: 0.025, duration: 0.15, rmsDb: -37, highpass: 150 });
takes('catch', 870740, [[0, 0.18], [1.29, 1.49]], { peakAt: 0.01, duration: 0.11, rmsDb: -35, highpass: 120, lowpass: 6500 });
takes('open', 321811, [[0.06, 0.29], [0.45, 0.67], [0.73, 0.92]], { peakAt: 0.012, duration: 0.15, rmsDb: -29, highpass: 180, lowpass: 15000 });
takes('balisong', 853769, [[1.90, 2.10], [4.26, 4.45], [12.54, 12.75]], { peakAt: 0.012, duration: 0.15, rmsDb: -27.5, highpass: 180, lowpass: 15000 });
takes('flesh', 870740, [[0, 0.30], [1.28, 1.58], [2.30, 2.60]], { peakAt: 0.012, duration: 0.28, rmsDb: -13 });
takes('wall', 434338, [[3.48, 3.74], [9.54, 9.80], [16.65, 16.91]], { peakAt: 0.008, duration: 0.22, rmsDb: -14.5, highpass: 250, lowpass: 12000 });
for (const spec of [
  { sourceId: 528710, name: 'switch-open', start: 0.10, end: 0.39, peakAt: 0.015, duration: 0.20, rmsDb: -26.5, highpass: 180 },
  { sourceId: 321811, name: 'close', start: 0.73, end: 0.92, peakAt: 0.012, duration: 0.13, rmsDb: -33, highpass: 120, lowpass: 6500 },
  { sourceId: 524215, name: 'draw-fixed-1', start: 0.02, end: 0.50, peakAt: 0.13, duration: 0.32, rmsDb: -27, highpass: 700 },
  { sourceId: 524215, name: 'draw-fixed-2', start: 0.02, end: 0.50, rate: 1.06, peakAt: 0.13, duration: 0.32, rmsDb: -27, highpass: 700 },
  { sourceId: 524215, name: 'draw-ring-1', start: 0.08, end: 0.38, rate: 1.18, peakAt: 0.04, duration: 0.20, rmsDb: -29, highpass: 1100 },
  { sourceId: 524215, name: 'draw-ring-2', start: 0.08, end: 0.38, rate: 1.10, peakAt: 0.04, duration: 0.20, rmsDb: -29, highpass: 1100 },
  { sourceId: 411742, name: 'withdraw', start: 1.78, end: 2.02, peakAt: 0.04, duration: 0.30, rmsDb: -22, highpass: 400 },
]) {
  clips.push(render(sources.find(source => source.id === spec.sourceId), spec));
}
writeFileSync(path.join(output, 'sources.json'), `${JSON.stringify({ license, sources: provenance, clips }, null, 2)}\n`);
console.log(JSON.stringify(clips.map(({ file, peakAt, peakRmsDb }) => ({ file, peakMs: Math.round(peakAt * 1000), peakRmsDb: +peakRmsDb.toFixed(1) })), null, 2));