import {
  BackSide,
  Color,
  DirectionalLight,
  EquirectangularReflectionMapping,
  Fog,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PMREMGenerator,
  SRGBColorSpace,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Texture,
  TextureLoader,
  ImageBitmapLoader,
  Vector3,
  type Camera,
  type LoadingManager,
  type Material,
  type Object3D,
  type WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';
import type { LoadedMap, MapEnvironmentConfig, MapLightmapConfig, MapMeta } from './types';
import { DEFAULT_GRADE, inverseGrade, resolveGrade, type ColorGrade } from '../render/grade';
import { textureTranscoder } from '../assets/gltfLoader';
import { NormalFromAlbedo } from '../render/NormalFromAlbedo';
import { QUALITY_PRESETS, type QualityPreset } from '../render/quality';
import { buildBakedMaterial, buildFullBakeMaterial } from '../render/worldMaterials';

export interface ResolvedSky {
  zenith: Color;
  horizon: Color;
  ground: Color;
  exponent: number;
  sunSizeDeg: number;
  sunGlow: number;
  sunHaze: number;
  clouds: {
    color: Color;
    shadow: Color;
    coverage: number;
    scale: number;
    speed: number;
    height: number;
  };
  panorama: string | null;
}

/**
 * 'full': the lightmap holds every light (the v2 bakes), drawn unlit.
 * 'indirect': rgb holds sky and bounce light, alpha the sun's visibility; the
 * sun itself is live so normal maps, specular and player shadows work.
 */
export type LightmapMode = 'full' | 'indirect';

export interface ResolvedEnvironment {
  background: Color;
  sky: ResolvedSky | null;
  sunDirection: Vector3;
  sunColor: Color;
  sunIntensity: number;
  hemiSky: Color;
  hemiGround: Color;
  hemiIntensity: number;
  /** extra rim light, only used by the default look of maps without an environment */
  fillIntensity: number;
  fogColor: Color;
  fogNear: number;
  fogFar: number;
  exposure: number;
  lightmaps: MapLightmapConfig[];
  lightMapIntensity: number;
  lightmapMode: LightmapMode;
  /** multiplier on baked indirect light in 'indirect' mode */
  indirectIntensity: number;
  /** linear rgb gains on baked indirect light, luminance 1 */
  indirectTint: Color;
  /** sky light and reflections on players and weapons */
  envIntensity: number;
  grade: ColorGrade;
}

const DEFAULT_BACKGROUND = '#9ab9d5';

function finite(value: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/** scales a (linear) color so its luminance is 1, a pure hue shift when used as gains */
export function unitLuminance(c: Color): Color {
  const luma = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  return luma > 1e-4 ? c.multiplyScalar(1 / luma) : new Color(1, 1, 1);
}

function color(value: unknown, fallback: string): Color {
  if (typeof value === 'string') {
    try {
      return new Color(value);
    } catch {
      // fall through to the default
    }
  }
  return new Color(fallback);
}

/**
 * turns an optional meta.json `environment` block into complete values. maps
 * without one get the look the game always had (flat blue sky, hemi + sun + fill).
 */
export function resolveEnvironment(config?: MapEnvironmentConfig): ResolvedEnvironment {
  if (!config) {
    return {
      background: new Color(DEFAULT_BACKGROUND),
      sky: null,
      sunDirection: new Vector3(80, 140, 40).normalize(),
      sunColor: new Color('#ffffff'),
      sunIntensity: 1.35,
      hemiSky: new Color(0xdaf0ff),
      hemiGround: new Color(0x4c6a81),
      hemiIntensity: 1.05,
      fillIntensity: 0.45,
      fogColor: new Color(DEFAULT_BACKGROUND),
      fogNear: 140,
      fogFar: 1400,
      exposure: 1,
      lightmaps: [],
      lightMapIntensity: 1,
      lightmapMode: 'full',
      indirectIntensity: 1,
      indirectTint: new Color(1, 1, 1),
      envIntensity: 1,
      grade: resolveGrade(undefined, 1),
    };
  }
  const skyConfig = config.sky;
  const horizonFallback = typeof config.fog?.color === 'string' ? config.fog.color : DEFAULT_BACKGROUND;
  const sky: ResolvedSky | null = skyConfig
    ? {
        zenith: color(skyConfig.zenith, '#4f7fbf'),
        horizon: color(skyConfig.horizon, horizonFallback),
        ground: color(skyConfig.ground, '#5a5f66'),
        exponent: finite(skyConfig.exponent, 0.6, 0.05, 8),
        sunSizeDeg: finite(skyConfig.sunSizeDeg, 1.6, 0.1, 20),
        sunGlow: finite(skyConfig.sunGlow, 0.35, 0, 4),
        sunHaze: finite(skyConfig.sunHaze, 0.18, 0, 4),
        clouds: {
          color: color(skyConfig.clouds?.color, '#ffffff'),
          shadow: color(skyConfig.clouds?.shadow, '#9aa6b8'),
          coverage: finite(skyConfig.clouds?.coverage, 0, 0, 1),
          scale: finite(skyConfig.clouds?.scale, 1, 0.05, 20),
          speed: finite(skyConfig.clouds?.speed, 0.005, -1, 1),
          height: finite(skyConfig.clouds?.height, 0.3, 0.01, 1),
        },
        panorama: typeof skyConfig.panorama === 'string' && skyConfig.panorama.length > 0 ? skyConfig.panorama : null,
      }
    : null;
  const dir = config.sun?.direction;
  const sunDirection = Array.isArray(dir) && dir.length === 3 && dir.every((v) => Number.isFinite(v))
    && Math.hypot(dir[0], dir[1], dir[2]) > 1e-6
    ? new Vector3(dir[0], dir[1], dir[2]).normalize()
    : new Vector3(80, 140, 40).normalize();
  const fogColor = color(config.fog?.color, sky ? `#${sky.horizon.getHexString()}` : DEFAULT_BACKGROUND);
  const fogNear = finite(config.fog?.near, 140, 0);
  const lightmaps = Array.isArray(config.lightmaps)
    ? config.lightmaps.filter((entry) => entry && typeof entry.path === 'string' && entry.path.length > 0)
    : [];
  const exposure = finite(config.exposure, 1, 0.05, 8);
  return {
    background: color(config.background, `#${fogColor.getHexString()}`),
    sky,
    sunDirection,
    sunColor: color(config.sun?.color, '#ffffff'),
    sunIntensity: finite(config.sun?.intensity, 1.35, 0, 50),
    hemiSky: color(config.hemi?.sky, '#daf0ff'),
    hemiGround: color(config.hemi?.ground, '#4c6a81'),
    hemiIntensity: finite(config.hemi?.intensity, 1.05, 0, 50),
    fillIntensity: 0,
    fogColor,
    fogNear,
    fogFar: Math.max(fogNear + 1, finite(config.fog?.far, 1400, 1)),
    exposure,
    lightmaps,
    lightMapIntensity: finite(config.lightMapIntensity, Math.PI, 0, 100),
    lightmapMode: config.lightmapMode === 'indirect' ? 'indirect' : 'full',
    indirectIntensity: finite(config.indirectIntensity, 1, 0, 8),
    indirectTint: unitLuminance(color(config.indirectTint, '#ffffff')),
    envIntensity: finite(config.envIntensity, 1, 0, 8),
    grade: resolveGrade(config.grade, exposure),
  };
}

/** which entry of `lightmaps` a mesh uses: the first whose `match` is in its name, else the default */
export function lightmapIndexForMesh(name: string, lightmaps: readonly MapLightmapConfig[]): number {
  const matched = lightmaps.findIndex((entry) => typeof entry.match === 'string' && entry.match.length > 0 && name.includes(entry.match));
  if (matched >= 0) {
    return matched;
  }
  return lightmaps.findIndex((entry) => !entry.match);
}

/** paths in meta.json are site absolute (/maps/...) or relative to the meta file */
export function resolveMapAssetPath(path: string, metaPath: string): string {
  if (/^([a-z]+:)?\/\//i.test(path) || path.startsWith('/') || path.startsWith('data:') || path.startsWith('blob:')) {
    return path;
  }
  const slash = metaPath.lastIndexOf('/');
  return `${slash >= 0 ? metaPath.slice(0, slash + 1) : ''}${path}`;
}

/**
 * loads the lightmaps a map lists in its meta. they are sampled through the
 * second uv set (GLTFLoader names TEXCOORD_1 `uv1`) and keep gltf orientation.
 * a failed lightmap is skipped so the map still loads with real-time lighting.
 */
export async function loadMapLightmaps(
  meta: MapMeta,
  metaPath: string,
  manager?: LoadingManager,
  onLog?: (message: string) => void,
): Promise<Array<Texture | null>> {
  const entries = resolveEnvironment(meta.environment).lightmaps;
  if (entries.length === 0) {
    return [];
  }
  // the alpha channel carries sun visibility, so the rgb must not be premultiplied
  // by it on decode. ImageBitmap with premultiplyAlpha 'none' guarantees that.
  const useBitmap = typeof createImageBitmap === 'function';
  const loader = useBitmap
    ? new ImageBitmapLoader(manager).setOptions({ imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
    : new TextureLoader(manager);
  const ktx2 = textureTranscoder();
  const textures = await Promise.all(entries.map(async (entry) => {
    const url = resolveMapAssetPath(entry.path, metaPath);
    try {
      if (url.endsWith('.ktx2') && ktx2) {
        // gpu compressed, srgb rgb and linear alpha come from the file itself
        const compressed = await ktx2.loadAsync(url);
        compressed.name = entry.path;
        compressed.channel = 1;
        return compressed;
      }
      const loaded = await loader.loadAsync(url);
      const texture = loaded instanceof Texture ? loaded : new Texture(loaded as ImageBitmap);
      texture.name = entry.path;
      texture.flipY = false;
      texture.colorSpace = SRGBColorSpace;
      texture.channel = 1;
      texture.needsUpdate = true;
      return texture;
    } catch (error) {
      onLog?.(`[MapEnvironment] lightmap ${url} failed to load: ${String(error)}`);
      return null;
    }
  }));
  return textures;
}

const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = clip.xyww;
  gl_Position.z *= 0.99999;
}
`;

// linear hdr sky. the gradient keys are the map's display colours run back
// through the grade, so after tone mapping the horizon lands exactly on the
// fog colour. the sun disc is far above 1 so bloom turns it into glare.
const SKY_FRAGMENT = /* glsl */ `
#ifndef CLOUD_OCTAVES
#define CLOUD_OCTAVES 5
#endif
uniform vec3 zenith;
uniform vec3 horizon;
uniform vec3 ground;
uniform vec3 sunDisc;
uniform vec3 sunGlowColor;
uniform vec3 sunDir;
uniform vec3 cloudColor;
uniform vec3 cloudShadow;
uniform float exponent;
uniform float sunOuter;
uniform float sunInner;
uniform float sunGlow;
uniform float sunHaze;
uniform float cloudCoverage;
uniform float cloudScale;
uniform float cloudHeight;
uniform float cloudShift;
uniform float showSun;
varying vec3 vDir;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float total = 0.0;
  float amp = 0.5;
  for (int i = 0; i < CLOUD_OCTAVES; i++) {
    total += amp * noise(p);
    p = p * 2.03 + vec2(17.1, 9.2);
    amp *= 0.5;
  }
  return total;
}

void main() {
  vec3 dir = normalize(vDir);
  float h = dir.y;
  vec3 col = h >= 0.0
    ? mix(horizon, zenith, pow(max(h, 0.0), exponent))
    : mix(horizon, ground, clamp(-h * 4.0, 0.0, 1.0));
  float d = max(dot(dir, sunDir), 0.0);
  float cover = 0.0;
  if (cloudCoverage > 0.0 && h > 0.0) {
    vec2 uv = dir.xz / (h + 0.18) * cloudScale + vec2(cloudShift, cloudShift * 0.37);
    float n = fbm(uv);
    float edge = 1.0 - cloudCoverage;
    cover = smoothstep(edge, edge + 0.24, n) * smoothstep(0.0, cloudHeight, h);
#if CLOUD_OCTAVES > 3
    // a second sample nudged towards the sun fakes self shadowing
    float towardSun = fbm(uv + normalize(sunDir.xz + 1e-4) * 0.12);
    float shade = clamp(0.55 + (n - towardSun) * 3.2, 0.0, 1.0);
#else
    float shade = clamp(0.45 + (n - edge) * 0.8, 0.0, 1.0);
#endif
    shade = clamp(shade + 0.35 * pow(d, 4.0), 0.0, 1.0);
    vec3 lit = mix(cloudShadow, cloudColor, shade);
    // thin cloud edges near the sun glow
    lit += sunGlowColor * pow(d, 12.0) * (1.0 - smoothstep(edge, edge + 0.5, n)) * 0.8;
    col = mix(col, lit, cover * 0.94);
  }
  float glow = pow(d, 48.0) * sunGlow + pow(d, 6.0) * sunHaze * (1.0 - cover * 0.5);
  col += sunGlowColor * glow * (1.0 - cover * 0.6);
  float disc = smoothstep(sunOuter, sunInner, d) * (1.0 - cover * 0.9) * showSun;
  col = mix(col, sunDisc, disc);
  gl_FragColor = vec4(col, 1.0);
}
`;

function createSkyMaterial(octaves: number): ShaderMaterial {
  return new ShaderMaterial({
    name: 'MapSkyDome',
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    defines: { CLOUD_OCTAVES: octaves },
    uniforms: {
      zenith: { value: new Vector3() },
      horizon: { value: new Vector3() },
      ground: { value: new Vector3() },
      sunDisc: { value: new Vector3() },
      sunGlowColor: { value: new Vector3() },
      sunDir: { value: new Vector3(0, 1, 0) },
      cloudColor: { value: new Vector3() },
      cloudShadow: { value: new Vector3() },
      exponent: { value: 0.6 },
      sunOuter: { value: 0.999 },
      sunInner: { value: 0.9995 },
      sunGlow: { value: 0.35 },
      sunHaze: { value: 0.18 },
      cloudCoverage: { value: 0 },
      cloudScale: { value: 1 },
      cloudHeight: { value: 0.3 },
      cloudShift: { value: 0 },
      showSun: { value: 1 },
    },
    side: BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: false,
  });
}

function hdr(display: Color, grade: ColorGrade): Vector3 {
  const c = inverseGrade(display, grade);
  return new Vector3(c.r, c.g, c.b);
}

/** how far the shadow box reaches around the camera, metres */
const SHADOW_EXTENT_M = 26;

/**
 * per-map sky, fog, grade, lights and lightmaps. GameApp owns one and calls
 * {@link apply} whenever a map is activated and {@link update} every frame.
 *
 * sky maps light players and weapons with a live sun plus an environment map
 * captured from the sky; the hemisphere light only stays for maps without one.
 */
export class MapEnvironment {
  private readonly hemi = new HemisphereLight();
  private readonly sun = new DirectionalLight();
  private readonly fill = new DirectionalLight(0xc7e8ff, 0.45);
  private skyMaterial: ShaderMaterial;
  private readonly skyMesh: Mesh;
  private readonly envScene = new Scene();
  private readonly envSky: Mesh;
  private envTarget: WebGLRenderTarget | null = null;
  private readonly normals: NormalFromAlbedo;
  private panorama: Texture | null = null;
  private cloudSpeed = 0;
  private elapsed = 0;
  private resolved: ResolvedEnvironment = resolveEnvironment();
  private preset: QualityPreset = QUALITY_PRESETS.high;
  private map: LoadedMap | null = null;
  private readonly tmp = new Vector3();

  constructor(private readonly scene: Scene, private readonly renderer: WebGLRenderer) {
    this.sun.castShadow = false;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.fill.position.set(-70, 40, -80);
    this.scene.add(this.hemi, this.sun, this.sun.target, this.fill);
    this.skyMaterial = createSkyMaterial(5);
    this.skyMesh = new Mesh(new SphereGeometry(50, 48, 24), this.skyMaterial);
    this.skyMesh.name = 'MapSkyDome';
    this.skyMesh.frustumCulled = false;
    this.skyMesh.renderOrder = -1000;
    this.skyMesh.visible = false;
    this.scene.add(this.skyMesh);
    this.envSky = new Mesh(this.skyMesh.geometry, this.skyMaterial.clone());
    this.envSky.frustumCulled = false;
    this.envScene.add(this.envSky);
    this.normals = new NormalFromAlbedo(renderer);
    this.applyResolved(this.resolved);
  }

  public getResolved(): ResolvedEnvironment {
    return this.resolved;
  }

  public getGrade(): ColorGrade {
    return this.resolved.grade ?? { ...DEFAULT_GRADE };
  }

  /** sky capture for lighting the viewmodel, null on maps without a sky */
  public getEnvironmentTexture(): Texture | null {
    return this.envTarget?.texture ?? null;
  }

  /** the live sun, for lighting that has to match the world (viewmodel) */
  public getSunLight(): DirectionalLight {
    return this.sun;
  }

  public getHemisphereLight(): HemisphereLight {
    return this.hemi;
  }

  /** applies the map's environment (or the default one) and swaps in lightmapped materials */
  public apply(map: LoadedMap | null): void {
    this.map = map;
    const env = resolveEnvironment(map?.meta.environment);
    this.applyResolved(env);
    this.applyWorldMaterials();
    if (map) {
      this.sharpenTextures(map.sceneRoot);
    }
  }

  public setQuality(preset: QualityPreset): void {
    const previous = this.preset;
    this.preset = preset;
    const octaves = preset.level === 'low' ? 3 : 5;
    if (this.skyMaterial.defines.CLOUD_OCTAVES !== octaves) {
      this.skyMaterial.defines.CLOUD_OCTAVES = octaves;
      this.skyMaterial.needsUpdate = true;
    }
    this.syncShadows();
    if (previous.normalMapSize !== preset.normalMapSize) {
      // drop normal maps built at the old size so they don't sit in gpu memory
      this.normals.clear();
    }
    if (
      previous.detailedMaterials !== preset.detailedMaterials
      || previous.reflections !== preset.reflections
      || previous.normalMapSize !== preset.normalMapSize
    ) {
      this.applyWorldMaterials();
    }
    if (previous.anisotropy !== preset.anisotropy && this.map) {
      this.sharpenTextures(this.map.sceneRoot);
    }
  }

  public update(dt: number, camera: Camera): void {
    this.elapsed += dt;
    if (this.skyMesh.visible) {
      this.skyMesh.position.copy(camera.position);
      this.skyMaterial.uniforms.cloudShift.value = this.elapsed * this.cloudSpeed;
    }
    if (this.sun.castShadow) {
      // follow the camera, snapped to shadow texels so edges don't crawl
      const size = this.sun.shadow.mapSize.x;
      const texel = (SHADOW_EXTENT_M * 2) / size;
      const center = this.tmp.copy(camera.position);
      center.x = Math.round(center.x / texel) * texel;
      center.y = Math.round(center.y / texel) * texel;
      center.z = Math.round(center.z / texel) * texel;
      this.sun.target.position.copy(center);
      this.sun.position.copy(center).addScaledVector(this.resolved.sunDirection, 120);
      this.sun.target.updateMatrixWorld();
    }
  }

  public dispose(): void {
    this.scene.remove(this.hemi, this.sun, this.sun.target, this.fill, this.skyMesh);
    this.skyMesh.geometry.dispose();
    this.skyMaterial.dispose();
    (this.envSky.material as Material).dispose();
    this.envTarget?.dispose();
    this.envTarget = null;
    this.normals.dispose();
    this.panorama?.dispose();
    this.panorama = null;
  }

  private applyResolved(env: ResolvedEnvironment): void {
    this.resolved = env;
    const grade = env.grade;
    this.sun.color.copy(env.sunColor);
    this.sun.intensity = env.sunIntensity;
    this.sun.position.copy(env.sunDirection).multiplyScalar(200);
    this.sun.target.position.set(0, 0, 0);
    this.fill.intensity = env.fillIntensity;
    this.fill.visible = env.fillIntensity > 0;
    this.panorama?.dispose();
    this.panorama = null;
    this.envTarget?.dispose();
    this.envTarget = null;
    this.scene.environment = null;

    const sky = env.sky;
    // the fog blends in linear light, so give it the value that grades back to the authored colour
    const fogLinear = sky ? inverseGrade(env.fogColor, grade) : env.fogColor.clone();
    this.scene.fog = new Fog(fogLinear, env.fogNear, env.fogFar);
    this.hemi.color.copy(env.hemiSky);
    this.hemi.groundColor.copy(env.hemiGround);
    this.hemi.intensity = env.hemiIntensity;
    this.hemi.visible = true;
    if (!sky) {
      this.skyMesh.visible = false;
      this.scene.background = env.background.clone();
      this.syncShadows();
      return;
    }
    if (sky.panorama) {
      this.skyMesh.visible = false;
      this.scene.background = fogLinear.clone();
      const url = sky.panorama;
      new TextureLoader().load(url, (texture) => {
        if (this.resolved !== env) {
          texture.dispose();
          return;
        }
        texture.mapping = EquirectangularReflectionMapping;
        texture.colorSpace = SRGBColorSpace;
        this.panorama = texture;
        this.scene.background = texture;
      });
      this.syncShadows();
      return;
    }
    this.scene.background = fogLinear.clone();
    const sunLinear = inverseGrade(env.sunColor, grade);
    const values = {
      zenith: hdr(sky.zenith, grade),
      horizon: hdr(sky.horizon, grade),
      ground: hdr(sky.ground, grade),
      sunGlowColor: new Vector3(sunLinear.r, sunLinear.g, sunLinear.b),
      sunDisc: new Vector3(sunLinear.r, sunLinear.g, sunLinear.b).multiplyScalar(36),
      cloudColor: hdr(sky.clouds.color, grade),
      cloudShadow: hdr(sky.clouds.shadow, grade),
    };
    const size = (sky.sunSizeDeg * Math.PI) / 180;
    for (const material of [this.skyMaterial, this.envSky.material as ShaderMaterial]) {
      const u = material.uniforms;
      (u.zenith.value as Vector3).copy(values.zenith);
      (u.horizon.value as Vector3).copy(values.horizon);
      (u.ground.value as Vector3).copy(values.ground);
      (u.sunGlowColor.value as Vector3).copy(values.sunGlowColor);
      (u.sunDisc.value as Vector3).copy(values.sunDisc);
      (u.sunDir.value as Vector3).copy(env.sunDirection);
      (u.cloudColor.value as Vector3).copy(values.cloudColor);
      (u.cloudShadow.value as Vector3).copy(values.cloudShadow);
      u.exponent.value = sky.exponent;
      u.sunOuter.value = Math.cos(size * 1.25);
      u.sunInner.value = Math.cos(size * 0.75);
      u.sunGlow.value = sky.sunGlow;
      u.sunHaze.value = sky.sunHaze;
      u.cloudCoverage.value = sky.clouds.coverage;
      u.cloudScale.value = sky.clouds.scale;
      u.cloudHeight.value = sky.clouds.height;
    }
    this.cloudSpeed = sky.clouds.speed;
    this.skyMesh.visible = true;
    this.captureEnvironment(env);
    this.syncShadows();
  }

  /** prefiltered sky for ibl: players and world reflections, and the viewmodel through GameApp */
  private captureEnvironment(env: ResolvedEnvironment): void {
    const envMaterial = this.envSky.material as ShaderMaterial;
    // the real sun is a light, a disc in the capture would double its highlight
    envMaterial.uniforms.showSun.value = 0;
    envMaterial.uniforms.cloudShift.value = 0;
    const pmrem = new PMREMGenerator(this.renderer);
    const previous = this.renderer.getRenderTarget();
    this.envTarget = pmrem.fromScene(this.envScene, 0, 0.1, 200);
    this.renderer.setRenderTarget(previous);
    pmrem.dispose();
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = env.envIntensity;
    // the capture lights dynamic objects from the sky, the hemisphere would count it twice
    this.hemi.visible = false;
  }

  private syncShadows(): void {
    const size = this.preset.shadowMapSize;
    const enabled = size > 0 && this.resolved.sky !== null;
    this.renderer.shadowMap.enabled = enabled || this.renderer.shadowMap.enabled;
    if (enabled) {
      if (this.sun.shadow.mapSize.x !== size) {
        this.sun.shadow.mapSize.set(size, size);
        this.sun.shadow.map?.dispose();
        this.sun.shadow.map = null;
      }
      const cam = this.sun.shadow.camera;
      cam.left = -SHADOW_EXTENT_M;
      cam.right = SHADOW_EXTENT_M;
      cam.top = SHADOW_EXTENT_M;
      cam.bottom = -SHADOW_EXTENT_M;
      cam.near = 1;
      cam.far = 260;
      cam.updateProjectionMatrix();
      this.sun.shadow.radius = 2;
    }
    if (this.sun.castShadow !== enabled) {
      this.sun.castShadow = enabled;
      this.renderer.shadowMap.enabled = enabled;
      this.renderer.shadowMap.needsUpdate = true;
    }
  }

  private applyWorldMaterials(): void {
    const map = this.map;
    const env = this.resolved;
    if (!map) return;
    const textures = map.lightmaps ?? [];
    map.sceneRoot.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      // the world only receives live shadows, its own come from the bake
      child.receiveShadow = true;
      child.castShadow = false;
      if (env.lightmapMode === 'indirect' && child.geometry.getAttribute('uv1') && !child.userData.windingNormals) {
        rebuildNormalsFromWinding(child);
      }
    });
    if (env.lightmaps.length === 0 || textures.length === 0) return;
    applyLightmaps(map.sceneRoot, env, textures, {
      preset: this.preset,
      normals: this.normals,
    });
  }

  private sharpenTextures(root: Object3D): void {
    const anisotropy = Math.min(this.preset.anisotropy, this.renderer.capabilities.getMaxAnisotropy());
    root.traverse((child) => {
      if (!(child instanceof Mesh)) {
        return;
      }
      for (const material of materialList(child.material)) {
        const map = (material as MeshBasicMaterial).map;
        if (map && map.anisotropy !== anisotropy) {
          map.anisotropy = anisotropy;
          map.needsUpdate = true;
        }
      }
    });
  }
}

function materialList(material: Material | Material[]): Material[] {
  return Array.isArray(material) ? material : [material];
}

/**
 * some faces of the packed maps (the big floor slabs) carry normals that point
 * against their winding. cycles baked against the winding, so live lighting
 * has to use it too: rebuild float normals from the triangles. the v2 unlit
 * materials never read normals, which is why this never showed before.
 */
export function rebuildNormalsFromWinding(mesh: Mesh): void {
  const geometry = mesh.geometry;
  geometry.deleteAttribute('normal');
  geometry.computeVertexNormals();
  mesh.userData.windingNormals = true;
}

export interface LightmapBuildOptions {
  preset: QualityPreset;
  normals: NormalFromAlbedo | null;
}

/**
 * gives every mesh with a `uv1` attribute its lightmapped material. v2 'full'
 * bakes become MeshBasicMaterial(map, color, lightMap); 'indirect' bakes get a
 * lit material with the sun masked by the bake (see render/worldMaterials).
 * the gltf material is kept in userData so a preset change can rebuild from it.
 * shared materials are converted once. returns how many meshes got a lightmap.
 */
export function applyLightmaps(
  root: Object3D,
  env: ResolvedEnvironment,
  textures: readonly (Texture | null)[],
  options?: LightmapBuildOptions,
): number {
  const converted = new Map<string, Material>();
  let count = 0;
  const indirect = env.lightmapMode === 'indirect' && options !== undefined;
  root.traverse((child) => {
    if (!(child instanceof Mesh) || !child.geometry.getAttribute('uv1')) {
      return;
    }
    const index = lightmapIndexForMesh(child.name, env.lightmaps);
    const texture = index >= 0 ? textures[index] : null;
    if (!texture) {
      return;
    }
    const sources: Material[] = child.userData.sourceMaterials
      ?? (Array.isArray(child.material) ? child.material : [child.material]);
    child.userData.sourceMaterials = sources;
    const swap = (material: Material): Material => {
      if (!(material instanceof MeshStandardMaterial)) {
        return material;
      }
      const key = `${material.uuid}:${index}`;
      let built = converted.get(key);
      if (!built) {
        built = indirect
          ? buildBakedMaterial(material, {
              preset: options.preset,
              lightMap: texture,
              lightMapIntensity: env.lightMapIntensity * env.indirectIntensity,
              indirectTint: env.indirectTint,
              normals: options.normals,
              skyRef: 0.9,
            })
          : buildFullBakeMaterial(material, texture, env.lightMapIntensity);
        converted.set(key, built);
      }
      return built;
    };
    const previous = child.material;
    const next = sources.length === 1 && !Array.isArray(child.material) ? swap(sources[0]) : sources.map(swap);
    child.material = next;
    for (const old of materialList(previous)) {
      if (!sources.includes(old) && !materialList(next).includes(old)) {
        old.dispose();
      }
    }
    count += 1;
  });
  return count;
}
