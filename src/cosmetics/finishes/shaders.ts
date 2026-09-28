import type { KnifeFinishWearStyle } from './catalog';

/**
 * GLSL for the knife finishes, injected into MeshStandardMaterial with
 * onBeforeCompile. Everything works in knife space (metres, +x from the guard
 * to the tip, +y to the spine) from attributes baked by applyFinish.ts, so
 * models need no special UVs. All patterns are original procedural noise.
 *
 * attributes (per vertex, rest pose):
 * - finishPos    xyz knife space position
 * - finishNormal xyz knife space normal, w blade height
 * - finishUv     x u (0 guard .. 1 tip), y v (0 edge .. 1 spine), z metres to the cutting edge, w blade length
 */

const VERTEX_PARS = /* glsl */ `
attribute vec3 finishPos;
attribute vec4 finishNormal;
attribute vec4 finishUv;
varying vec3 vFinishPos;
varying vec4 vFinishNormal;
varying vec4 vFinishUv;
`;

const VERTEX_MAIN = /* glsl */ `
vFinishPos = finishPos;
vFinishNormal = finishNormal;
vFinishUv = finishUv;
`;

// shared helpers: noise, steel, wear
const FRAGMENT_LIB = /* glsl */ `
uniform vec4 finSeed;
uniform vec4 finParams;
uniform vec4 finWear;
uniform vec4 finBase;
uniform vec4 finData[6];
varying vec3 vFinishPos;
varying vec4 vFinishNormal;
varying vec4 vFinishUv;

struct FinishIn {
  vec3 pos;
  vec3 normal;
  vec2 uv;
  float edgeDist;
  float bladeLength;
  float bladeHeight;
  float edgeY;
  float ndv;
};

float finHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float finNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float a = finHash(i);
  float b = finHash(i + vec3(1.0, 0.0, 0.0));
  float c = finHash(i + vec3(0.0, 1.0, 0.0));
  float d = finHash(i + vec3(1.0, 1.0, 0.0));
  float e = finHash(i + vec3(0.0, 0.0, 1.0));
  float g = finHash(i + vec3(1.0, 0.0, 1.0));
  float h = finHash(i + vec3(0.0, 1.0, 1.0));
  float k = finHash(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
}

vec3 finHash3(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx) * 2.0 - 1.0;
}

// gradient noise, about -1..1
float finGrad(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(finHash3(i), f);
  float b = dot(finHash3(i + vec3(1.0, 0.0, 0.0)), f - vec3(1.0, 0.0, 0.0));
  float c = dot(finHash3(i + vec3(0.0, 1.0, 0.0)), f - vec3(0.0, 1.0, 0.0));
  float d = dot(finHash3(i + vec3(1.0, 1.0, 0.0)), f - vec3(1.0, 1.0, 0.0));
  float e = dot(finHash3(i + vec3(0.0, 0.0, 1.0)), f - vec3(0.0, 0.0, 1.0));
  float g = dot(finHash3(i + vec3(1.0, 0.0, 1.0)), f - vec3(1.0, 0.0, 1.0));
  float h = dot(finHash3(i + vec3(0.0, 1.0, 1.0)), f - vec3(0.0, 1.0, 1.0));
  float k = dot(finHash3(i + vec3(1.0, 1.0, 1.0)), f - vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, g, u.x), mix(h, k, u.x), u.y), u.z);
}

// 0..1 with mean 0.5 and a standard deviation of about 0.12 (thresholds in finishMaterials.ts rely on it)
float finFbm(vec3 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * finGrad(p);
    p = p * 2.03 + vec3(3.1, 1.7, 5.3);
    a *= 0.5;
  }
  return clamp(0.5 + 1.1 * s, 0.0, 1.0);
}

// thin lines along the zero crossings of a noise field, smoke and marble veins
float finVein(vec3 p, float width) {
  float n = finGrad(p);
  return 1.0 - smoothstep(0.0, width + fwidth(n), abs(n));
}

vec2 finRot(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

vec3 finLin(vec3 srgb) {
  return pow(srgb, vec3(2.2));
}

// anti-aliased step and line, aa from screen derivatives of a continuous value
float finStep(float edge, float x) {
  float aa = max(fwidth(x), 1e-5);
  return smoothstep(edge - aa, edge + aa, x);
}

float finLineAA(float d, float w, float aa) {
  aa = max(aa, 1e-6);
  return 1.0 - smoothstep(w - aa, w + aa, abs(d));
}

float finLine(float d, float w) {
  return finLineAA(d, w, fwidth(d));
}

// blade flats read xy, spines and rims read xz
vec2 finPlanar(FinishIn fi) {
  return abs(fi.normal.z) >= abs(fi.normal.y) ? fi.pos.xy : fi.pos.xz;
}

// satin steel with brushing along the blade, what wear uncovers
vec3 finSteel(vec3 p, out float rough) {
  float s = finNoise(vec3(p.x * 55.0, p.y * 2400.0, p.z * 2400.0));
  rough = 0.22 + 0.14 * s;
  return vec3(0.62, 0.635, 0.66) * (0.9 + 0.12 * s);
}

float finScratches(vec3 p, float amount) {
  float s = 0.0;
  for (int i = 0; i < 3; i++) {
    float k = float(i);
    float a = (finHash(vec3(k, 1.3, 2.9)) - 0.5) * 1.1;
    vec2 q = finRot(p.xy + vec2(p.z * 0.5), a);
    // long thin streaks from stretched noise, gathered in sparse clusters
    float streak = finNoise(vec3(q.x * 22.0 + k * 17.0, q.y * 1800.0, k * 5.0 + finSeed.x));
    float gate = smoothstep(0.62, 0.8, finNoise(vec3(q.x * 40.0, q.y * 60.0, k * 9.0 + 3.0 + finSeed.y)));
    s = max(s, finStep(0.93, streak) * gate);
  }
  return s * amount;
}

// 1 where the finish is worn through: exposed spots (edge, spine, tip, rims) go first
float finWearMask(FinishIn fi) {
#if defined(FINISH_WEAR_NONE) || defined(FINISH_WEAR_ETCHED)
  return 0.0;
#else
  float w = finWear.x;
  float nearEdge = 1.0 - smoothstep(0.0004, 0.003, fi.edgeDist);
  float rim = 1.0 - smoothstep(0.25, 0.8, abs(fi.normal.z));
  float tip = smoothstep(0.86, 1.02, fi.uv.x);
  float exposure = max(max(nearEdge, rim * 0.9), tip * 0.6);
  vec3 wp = fi.pos + finSeed.zxy * 0.002;
  float blotch = finFbm(wp * 45.0 + 11.0);
  float grunge = finFbm(wp * 190.0);
  float score = exposure * 0.55 + blotch * 0.9 + grunge * 0.3;
#if defined(FINISH_WEAR_PAINT)
  float amount = w * 0.75;
  float scratchAmount = smoothstep(0.1, 0.6, w);
#elif defined(FINISH_WEAR_ANODIZED)
  float amount = w;
  float scratchAmount = smoothstep(0.02, 0.2, w) * 0.6;
#else
  float amount = w * 0.35;
  float scratchAmount = smoothstep(0.2, 1.0, w) * 0.4;
#endif
  float chips = finStep(1.25 - amount, score);
  return clamp(max(chips, finScratches(fi.pos, scratchAmount)), 0.0, 1.0);
#endif
}
`;

/**
 * one surface function per finish: albedo (linear), roughness and metalness.
 * finData and finParams carry the per-variant palette and seed knobs.
 */
export const FINISH_SURFACES: Readonly<Record<string, string>> = {
  doppler: /* glsl */ `
vec3 finSurface(FinishIn fi, inout float rough, inout float metal) {
  vec2 p2 = finRot(fi.pos.xy, finSeed.w);
  vec3 q = vec3(p2 * 15.0, fi.pos.z * 15.0) + finSeed.xyz;
  // two rounds of domain warping make the swirling smoke
  vec2 w1 = vec2(finFbm(q), finFbm(q + vec3(5.2, 1.3, 2.8)));
  vec3 q1 = q + vec3(3.0 * w1, 0.0);
  vec2 w2 = vec2(finFbm(q1 + vec3(1.7, 9.2, 0.0)), finFbm(q1 + vec3(8.3, 2.8, 0.0)));
  vec3 qw = q + vec3(3.5 * w2, 0.0);
  float f = finFbm(qw);
  float lit = smoothstep(finParams.x - 0.09, finParams.x + 0.07, f);
  vec3 c = mix(finData[0].rgb, finData[1].rgb, lit);
  c = mix(c, finData[2].rgb, smoothstep(0.45, 0.62, w2.x) * finParams.y * lit);
  c = mix(c, finData[3].rgb, smoothstep(0.6, 0.74, f) * finParams.z);
  // thin dark veins that follow the swirl
  float vein = finVein(qw * 1.3 + 7.0, 0.035);
  c = mix(c, finData[0].rgb, vein * 0.45);
  // black pearl: a blue to violet sheen that shifts with the view
  vec3 sheen = mix(vec3(0.25, 0.12, 0.55), vec3(0.08, 0.42, 0.5), 0.5 + 0.5 * cos(6.2831 * (fi.ndv * 1.3 + w2.y * 2.0)));
  c = mix(c, c + sheen * (0.2 + 0.3 * lit), finParams.w);
  rough = mix(0.2, 0.08, lit);
  metal = 1.0;
  return c;
}
`,
  marble_fade: /* glsl */ `
vec3 finSurface(FinishIn fi, inout float rough, inout float metal) {
  vec2 p2 = finRot(fi.pos.xy, finSeed.w);
  vec3 q = vec3(p2 * 12.0, fi.pos.z * 12.0) + finSeed.xyz;
  vec2 w1 = vec2(finFbm(q), finFbm(q + vec3(5.2, 1.3, 2.8)));
  vec3 qw = q + vec3(2.2 * w1, 0.0);
  float warp = finFbm(qw);
  // wide colour lanes across the blade, flowing back from the tip and bent by the marble
  float band = fi.uv.x * 1.25 + (clamp(fi.uv.y, 0.0, 1.0) - 0.5) * 0.45 + (warp - 0.5) * 1.4 + finParams.z * 3.0;
  float k = fract(band);
  vec3 red = finLin(vec3(0.95, 0.08, 0.1));
  vec3 yellow = finLin(vec3(1.0, 0.8, 0.14));
  vec3 blue = finLin(vec3(0.12, 0.24, 0.95));
  // fire and ice seeds have no yellow lane at all
  float y = finParams.x * 0.34;
  float b = 0.22 + 0.3 * finParams.y;
  float r = 1.0 - y - b;
  vec3 c = red;
  c = mix(c, blue, smoothstep(r - 0.14, r + 0.06, k));
  c = mix(c, yellow, smoothstep(r + b - 0.1, r + b + 0.08, k) * step(0.001, y));
  c = mix(c, red, smoothstep(0.92, 1.0, k));
  // translucent smoke wisps, with chrome showing through the thin candy coat
  c *= 1.0 - 0.45 * finVein(qw * 2.0 + 3.0, 0.05);
  c = mix(c, vec3(0.85), smoothstep(0.62, 0.8, finFbm(qw * 1.7 + 5.0)) * 0.22);
  rough = 0.1;
  metal = 1.0;
  return c;
}
`,
  fade: /* glsl */ `
vec3 finSurface(FinishIn fi, inout float rough, inout float metal) {
  // base (0) to tip (1), leaning back towards the spine; finParams.y where colour starts, x its span
  float t = fi.uv.x + (clamp(fi.uv.y, 0.0, 1.0) - 0.5) * 0.3;
  t = (t - finParams.y) / max(finParams.x, 0.1);
  t += (finFbm(fi.pos * 45.0 + finSeed.xyz) - 0.5) * 0.05;
  vec3 c = finLin(vec3(0.78, 0.8, 0.83));
  c = mix(c, finLin(vec3(1.0, 0.82, 0.3)), smoothstep(0.0, 0.2, t));
  c = mix(c, finLin(vec3(1.0, 0.5, 0.2)), smoothstep(0.2, 0.4, t));
  c = mix(c, finLin(vec3(1.0, 0.24, 0.55)), smoothstep(0.38, 0.62, t));
  c = mix(c, finLin(vec3(0.66, 0.2, 0.92)), smoothstep(0.62, 0.84, t));
  c = mix(c, finLin(vec3(0.36, 0.3, 1.0)), smoothstep(0.86, 1.06, t));
  rough = 0.1;
  metal = 1.0;
  return c;
}
`,
  tiger_tooth: /* glsl */ `
vec3 finSurface(FinishIn fi, inout float rough, inout float metal) {
  vec2 p = finPlanar(fi);
  float a = 1.2 + finSeed.w * 0.2;
  vec2 dir = vec2(cos(a), sin(a));
  float across = dot(p, dir);
  float along = dot(p, vec2(-dir.y, dir.x));
  // stripes bend gently and wobble
  float bend = sin(along * 90.0 + finSeed.x) * 0.0016 + (finFbm(vec3(p * 45.0, 1.0) + finSeed.xyz) - 0.5) * 0.012;
  float k = (across + bend) / 0.011 + finSeed.y;
  float aa = fwidth(k);
  float cell = floor(k);
  float x = fract(k) - 0.5;
  float jag = (finNoise(vec3(along * 500.0, cell, 4.0)) - 0.5) * 0.04;
  // stripes vary in width and taper to points along their length
  float taper = smoothstep(0.3, 0.52, finFbm(vec3(along * 16.0, cell * 3.7, 2.0)));
  float width = (0.13 + 0.14 * finHash(vec3(cell, 3.0, 1.0))) * taper;
  float stripe = finLineAA(x + jag, width, aa);
  float x2 = fract(k + 0.5) - 0.5;
  float thin = finLineAA(x2 + jag, 0.04, aa) * smoothstep(0.55, 0.65, finFbm(vec3(along * 80.0, cell * 3.1, 7.0)));
  stripe = max(stripe, thin);
  vec3 gold = mix(finLin(vec3(1.0, 0.64, 0.1)), finLin(vec3(1.0, 0.8, 0.28)), finFbm(vec3(p * 45.0, 2.0) + finSeed.xyz));
  vec3 brown = finLin(vec3(0.2, 0.08, 0.02));
  rough = mix(0.14, 0.3, stripe);
  metal = 1.0;
  return mix(gold, brown, stripe);
}
`,
  slaughter: /* glsl */ `
vec3 finSurface(FinishIn fi, inout float rough, inout float metal) {
  vec2 p2 = finRot(finPlanar(fi), finSeed.w);
  vec3 q = vec3(p2 * 20.0, fi.pos.z * 20.0) + finSeed.xyz;
  vec2 w = vec2(finFbm(q * 0.8), finFbm(q * 0.8 + vec3(4.1, 7.3, 1.2)));
  float g = finFbm(q * 1.4 + vec3(w * 2.0, 3.0));
  // wavy bands of chrome under red, like a flowing damascus
  float f = sin((q.x * 1.1 + q.y * 0.5 + (w.x - 0.5) * 9.0 + (w.y - 0.5) * 4.0) * 2.0);
  vec3 c = mix(finLin(vec3(1.0, 0.46, 0.5)), finLin(vec3(0.74, 0.07, 0.11)), smoothstep(0.35, 0.65, f));
  c = mix(c, finLin(vec3(1.0, 0.84, 0.84)), (1.0 - smoothstep(-0.8, -0.45, f)) * smoothstep(0.45, 0.6, g));
  rough = 0.12;
  metal = 1.0;
  return c;
}
`,
  crimson_web: /* glsl */ `
float finWeb(vec2 p, vec2 hub, float spin, float radius) {
  vec2 d = p - hub;
  float r = length(d) + 1e-6;
  float sector = 6.2831853 / 14.0;
  float k = (atan(d.y, d.x) + spin) / sector;
  float kf = fract(k);
  // spokes sit on the sector borders
  float toSpoke = r * sin(min(kf, 1.0 - kf) * sector);
  // rings are chords between spokes that sag a little towards the hub
  float da = (kf - 0.5) * sector;
  float chord = r * cos(da) / cos(0.5 * sector);
  float sag = 1.0 - 0.12 * (1.0 - pow(abs(da) / (0.5 * sector), 2.0));
  float spacing = radius * 0.08;
  float ringK = pow(chord / sag / spacing, 0.85);
  float ringD = (fract(ringK + 0.5) - 0.5) * spacing;
  float w = radius * 0.004 + 0.00022;
  float lines = max(finLine(toSpoke, w), finLineAA(ringD, w, fwidth(ringK) * spacing));
  return lines * (1.0 - smoothstep(radius * 0.8, radius, r));
}

vec3 finSurface(FinishIn fi, inout float rough, inout float metal) {
  vec2 p = finPlanar(fi);
  float radius = fi.bladeLength * 0.62;
  // the nearest hub owns the spot, like webs meeting
  float best = 1e9;
  vec3 hub = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    vec4 h = finData[i];
    vec2 c = vec2(h.x * fi.bladeLength, fi.edgeY + h.y * fi.bladeHeight);
    float dist = distance(p, c) + (1.0 - h.w) * 1e6;
    float take = step(dist, best);
    best = mix(best, dist, take);
    hub = mix(hub, vec3(c, h.z), take);
  }
  float lines = finWeb(p, hub.xy, hub.z, radius);
  float shade = finFbm(fi.pos * 30.0 + finSeed.xyz);
  vec3 c = mix(finLin(vec3(0.74, 0.07, 0.08)), finLin(vec3(0.46, 0.02, 0.03)), clamp(smoothstep(0.55, 0.9, fi.uv.y) * 0.5 + (shade - 0.5) * 0.4, 0.0, 1.0));
  c = mix(c, finLin(vec3(0.03, 0.01, 0.01)), lines);
  rough = 0.42;
  metal = 0.05;
  return c;
}
`,
  case_hardened: /* glsl */ `
vec3 finSurface(FinishIn fi, inout float rough, inout float metal) {
  vec2 p2 = finRot(finPlanar(fi), finSeed.w);
  vec3 q = vec3(p2 * 22.0, fi.pos.z * 22.0) + finSeed.xyz;
  float w = finFbm(q * 0.9);
  float n = finFbm(q + vec3(w * 2.4, w * 1.6, 0.0));
  float m = finFbm(q * 2.1 + vec3(w, -w, 4.0));
  float thr = finParams.x;
  float blue = finStep(thr, n);
  float frame = finLine(n - thr + 0.02, 0.018);
  vec3 gold = mix(finLin(vec3(0.78, 0.56, 0.2)), finLin(vec3(0.95, 0.8, 0.42)), m);
  vec3 steel = finLin(vec3(0.72, 0.73, 0.76));
  vec3 base = mix(gold, steel, smoothstep(0.5, 0.7, m) * 0.75);
  vec3 blueC = mix(finLin(vec3(0.07, 0.2, 0.62)), finLin(vec3(0.32, 0.55, 0.92)), smoothstep(0.35, 0.8, finFbm(q * 3.0 + 9.0)));
  vec3 c = mix(base, blueC, blue);
  // blue patches are framed in purple
  c = mix(c, finLin(vec3(0.48, 0.22, 0.58)), frame * 0.85 * (1.0 - blue));
  // patina darkens at high floats instead of scratching
  c *= 1.0 - 0.4 * smoothstep(0.05, 1.0, finWear.x);
  rough = 0.2 + 0.25 * finWear.x;
  metal = 1.0;
  return c;
}
`,
  damascus_steel: /* glsl */ `
vec3 finSurface(FinishIn fi, inout float rough, inout float metal) {
  vec2 p = finPlanar(fi);
  vec3 q = vec3(p.x * 8.0, p.y * 15.0, fi.pos.z * 15.0) + finSeed.xyz;
  vec2 w = vec2(finFbm(q), finFbm(q + vec3(5.2, 1.3, 2.8)));
  float f = finFbm(q + vec3(w * 2.0, 0.0));
  // folded layers: contour lines of a warped field, running along the blade
  float k = f * 16.0 + p.y * 60.0;
  float light = finLineAA(fract(k) - 0.5, 0.17, fwidth(k));
  vec3 c = mix(finLin(vec3(0.36, 0.37, 0.4)), finLin(vec3(0.84, 0.85, 0.88)), light);
  c *= 1.0 - 0.35 * smoothstep(0.05, 0.5, finWear.x);
  rough = mix(0.3, 0.16, light);
  metal = 1.0;
  return c;
}
`,
  ultraviolet: /* glsl */ `
vec3 finSurface(FinishIn fi, inout float rough, inout float metal) {
  // matte black paint with a faint violet cloud
  float m = finFbm(fi.pos * 36.0 + finSeed.xyz);
  float speck = finNoise(fi.pos * 1500.0);
  vec3 c = mix(finLin(vec3(0.06, 0.05, 0.08)), finLin(vec3(0.11, 0.07, 0.16)), smoothstep(0.45, 0.65, m));
  c *= 0.92 + 0.12 * speck;
  rough = 0.66;
  metal = 0.1;
  return c;
}
`,
  night: /* glsl */ `
vec3 finSurface(FinishIn fi, inout float rough, inout float metal) {
  // night sky blue grey, stonewashed
  float m = finFbm(fi.pos * 80.0 + finSeed.xyz);
  float speck = finNoise(fi.pos * 1500.0);
  vec3 c = mix(finLin(vec3(0.11, 0.13, 0.16)), finLin(vec3(0.13, 0.155, 0.19)), smoothstep(0.42, 0.6, m));
  c *= 0.9 + 0.14 * speck;
  rough = 0.68;
  metal = 0.15;
  return c;
}
`,
  blue_steel: /* glsl */ `
vec3 finSurface(FinishIn fi, inout float rough, inout float metal) {
  vec2 p2 = finRot(finPlanar(fi), finSeed.w);
  vec3 q = vec3(p2 * 20.0, fi.pos.z * 20.0) + finSeed.xyz;
  float w = finFbm(q);
  float n = finFbm(q * 1.4 + vec3(w * 2.0));
  float speck = finNoise(fi.pos * 1100.0 + finSeed.xyz);
  // blued steel with darker patina clouds and pale purple and green tints
  vec3 c = mix(finLin(vec3(0.42, 0.52, 0.66)), finLin(vec3(0.14, 0.2, 0.34)), smoothstep(0.5, 0.64, n));
  c = mix(c, finLin(vec3(0.5, 0.44, 0.64)), smoothstep(0.58, 0.72, finFbm(q * 0.7 + 11.0)) * 0.35);
  c = mix(c, finLin(vec3(0.38, 0.55, 0.52)), smoothstep(0.6, 0.74, finFbm(q * 0.8 + 23.0)) * 0.25);
  c *= 0.9 + 0.14 * speck;
  c *= 1.0 - 0.4 * smoothstep(0.2, 1.0, finWear.x);
  rough = 0.26 + 0.2 * finWear.x;
  metal = 1.0;
  return c;
}
`,
  stained: /* glsl */ `
vec3 finSurface(FinishIn fi, inout float rough, inout float metal) {
  vec2 p2 = finRot(finPlanar(fi), finSeed.w);
  vec3 q = vec3(p2 * 30.0, fi.pos.z * 30.0) + finSeed.xyz;
  float w = finFbm(q * 0.8);
  float n = finFbm(q + vec3(w * 1.6));
  float stain = finStep(0.54, n);
  vec3 c = mix(finLin(vec3(0.78, 0.79, 0.81)), finLin(vec3(0.44, 0.45, 0.48)), stain);
  c = mix(c, finLin(vec3(0.8, 0.72, 0.48)), smoothstep(0.54, 0.66, finFbm(q * 1.4 + 5.0)) * (1.0 - stain) * 0.85);
  // acid stains leave darker blue rims
  c = mix(c, finLin(vec3(0.3, 0.36, 0.66)), finLine(n - 0.54, 0.01) * 0.85);
  c *= 1.0 - 0.35 * smoothstep(0.2, 1.0, finWear.x);
  rough = 0.28 + 0.12 * stain + 0.15 * finWear.x;
  metal = 1.0;
  return c;
}
`,
  safari_mesh: /* glsl */ `
float finHexEdge(vec2 p) {
  vec2 s = vec2(1.0, 1.7320508);
  vec4 hc = floor(vec4(p, p - vec2(0.5, 1.0)) / s.xyxy) + 0.5;
  vec4 h = vec4(p - hc.xy * s, p - (hc.zw + 0.5) * s);
  vec2 g = dot(h.xy, h.xy) < dot(h.zw, h.zw) ? h.xy : h.zw;
  vec2 a = abs(g);
  return 0.5 - max(dot(a, s * 0.5), a.x);
}

vec3 finSurface(FinishIn fi, inout float rough, inout float metal) {
  vec2 p = finPlanar(fi);
  vec2 warp = vec2(finFbm(vec3(p * 55.0, 1.0)), finFbm(vec3(p * 55.0, 7.0))) - 0.5;
  vec2 m = finRot(p + warp * 0.005, finSeed.w + 0.5) / 0.009 + finSeed.xy;
  float e = finHexEdge(m);
  float line = finLineAA(e, 0.06, fwidth(e));
  float blot = smoothstep(0.45, 0.65, finFbm(vec3(p * 28.0, 3.0) + finSeed.xyz));
  vec3 c = mix(finLin(vec3(0.37, 0.37, 0.27)), finLin(vec3(0.29, 0.3, 0.2)), blot * 0.7);
  c = mix(c, finLin(vec3(0.58, 0.56, 0.43)), line * 0.85);
  rough = 0.78;
  metal = 0.0;
  return c;
}
`,
  boreal_forest: /* glsl */ `
vec3 finSurface(FinishIn fi, inout float rough, inout float metal) {
  vec2 p = finPlanar(fi) + finSeed.xy * 0.01;
  vec3 q = vec3(p * 34.0, 0.0);
  float jag = (finNoise(vec3(p * 600.0, 3.0)) - 0.5) * 0.035;
  float l1 = finFbm(q + finSeed.xyz) + jag;
  float l2 = finFbm(q * 1.25 + 17.0) + jag;
  float l3 = finFbm(q * 1.6 + 31.0) + jag;
  vec3 c = finLin(vec3(0.6, 0.56, 0.36));
  c = mix(c, finLin(vec3(0.43, 0.53, 0.26)), finStep(0.5, l1));
  c = mix(c, finLin(vec3(0.19, 0.26, 0.13)), finStep(0.56, l2));
  c = mix(c, finLin(vec3(0.36, 0.25, 0.13)), finStep(0.6, l3));
  c = mix(c, finLin(vec3(0.24, 0.4, 0.32)), finStep(0.62, l2 + (l1 - 0.5) * 0.5) * 0.6);
  c = mix(c, finLin(vec3(0.08, 0.09, 0.07)), finStep(0.66, l1));
  rough = 0.72;
  metal = 0.0;
  return c;
}
`,
  scorched: /* glsl */ `
vec3 finSurface(FinishIn fi, inout float rough, inout float metal) {
  vec2 p = finPlanar(fi) + finSeed.xy * 0.01;
  vec3 q = vec3(p * 28.0, 0.0);
  float jag = (finNoise(vec3(p * 500.0, 5.0)) - 0.5) * 0.04;
  float l1 = finFbm(q + finSeed.xyz) + jag;
  float l2 = finFbm(q * 1.5 + 9.0) + jag;
  vec3 c = finLin(vec3(0.5, 0.49, 0.45));
  c = mix(c, finLin(vec3(0.3, 0.29, 0.27)), finStep(0.5, l2) * 0.85);
  c = mix(c, finLin(vec3(0.05, 0.05, 0.05)), finStep(0.54, l1));
  rough = 0.6;
  metal = 0.1;
  return c;
}
`,
};

const FRAGMENT_MAIN = /* glsl */ `
FinishIn fin;
fin.pos = vFinishPos;
fin.normal = normalize(vFinishNormal.xyz + vec3(0.0, 0.0, 1e-5));
fin.uv = vFinishUv.xy;
fin.edgeDist = vFinishUv.z;
fin.bladeLength = max(vFinishUv.w, 0.01);
fin.bladeHeight = max(vFinishNormal.w, 0.005);
fin.edgeY = vFinishPos.y - vFinishUv.y * fin.bladeHeight;
fin.ndv = abs(dot(normalize(vNormal), normalize(vViewPosition)));
float finRough = 0.5;
float finMetal = 1.0;
vec3 finAlbedo = finSurface(fin, finRough, finMetal);
float finWorn = finWearMask(fin);
#ifdef FINISH_HANDLE
  // paint on a handle: keeps a hint of the texture and wears down to the handle itself
  finAlbedo *= mix(vec3(1.0), diffuseColor.rgb, 0.5);
  finAlbedo = mix(finAlbedo, finBase.rgb, finWorn);
  finRough = mix(finRough, finBase.w, finWorn);
  finMetal = mix(finMetal, finWear.z, finWorn);
#else
  float finSteelRough;
  vec3 finSteelColor = finSteel(fin.pos, finSteelRough);
  // polished edge bevel
  finAlbedo = mix(finAlbedo, finSteelColor * 1.05, finWear.y);
  finRough = mix(finRough, 0.1, finWear.y);
  finMetal = mix(finMetal, 1.0, finWear.y);
  // worn through: scuffed bare steel, duller than the polished edge
  finAlbedo = mix(finAlbedo, finSteelColor * 0.82, finWorn);
  finRough = mix(finRough, finSteelRough + 0.12, finWorn);
  finMetal = mix(finMetal, 1.0, finWorn);
#endif
diffuseColor.rgb = finAlbedo;
`;

function inject(src: string, anchor: string, code: string, where: 'before' | 'after'): string {
  if (!src.includes(anchor)) throw new Error(`knife finish shader: missing "${anchor}"`);
  return src.replace(anchor, where === 'after' ? `${anchor}\n${code}` : `${code}\n${anchor}`);
}

export function finishVertexShader(src: string): string {
  let out = inject(src, '#include <common>', VERTEX_PARS, 'after');
  out = inject(out, '#include <begin_vertex>', VERTEX_MAIN, 'after');
  return out;
}

export function finishFragmentShader(src: string, finishId: string, wearStyle: KnifeFinishWearStyle, handle: boolean): string {
  const surface = FINISH_SURFACES[finishId];
  if (!surface) throw new Error(`knife finish shader: no surface for "${finishId}"`);
  const defines = [`#define FINISH_WEAR_${wearStyle.toUpperCase()}`, handle ? '#define FINISH_HANDLE' : ''].join('\n');
  let out = inject(src, 'void main() {', `${defines}\n${FRAGMENT_LIB}\n${surface}`, 'before');
  out = inject(out, '#include <map_fragment>', FRAGMENT_MAIN, 'after');
  out = inject(out, '#include <roughnessmap_fragment>', 'roughnessFactor = finRough;', 'after');
  out = inject(out, '#include <metalnessmap_fragment>', 'metalnessFactor = finMetal;', 'after');
  return out;
}
