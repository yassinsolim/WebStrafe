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
  SRGBColorSpace,
  ShaderMaterial,
  SphereGeometry,
  TextureLoader,
  Vector3,
  type Camera,
  type LoadingManager,
  type Material,
  type Object3D,
  type Scene,
  type Texture,
  type WebGLRenderer,
} from 'three';
import type { LoadedMap, MapEnvironmentConfig, MapLightmapConfig, MapMeta } from './types';

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
}

const DEFAULT_BACKGROUND = '#9ab9d5';

function finite(value: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
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
    exposure: finite(config.exposure, 1, 0.05, 8),
    lightmaps,
    lightMapIntensity: finite(config.lightMapIntensity, Math.PI, 0, 100),
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
  const loader = new TextureLoader(manager);
  const textures = await Promise.all(entries.map(async (entry) => {
    const url = resolveMapAssetPath(entry.path, metaPath);
    try {
      const texture = await loader.loadAsync(url);
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

// same gradient and sun as the blender preview (tools/blender/maps/maplib.py
// sky_display_nodes), plus drifting clouds. colours are display (srgb) values,
// so the horizon lines up exactly with the fog colour.
const SKY_FRAGMENT = /* glsl */ `
uniform vec3 zenith;
uniform vec3 horizon;
uniform vec3 ground;
uniform vec3 sunColor;
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
  for (int i = 0; i < 5; i++) {
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
    cover = smoothstep(edge, edge + 0.22, n) * smoothstep(0.0, cloudHeight, h);
    vec3 lit = mix(cloudShadow, cloudColor, clamp(0.45 + 0.55 * pow(d, 3.0) + (n - edge) * 0.6, 0.0, 1.0));
    col = mix(col, lit, cover * 0.92);
  }
  float disc = clamp((d - sunOuter) / max(sunInner - sunOuter, 1e-6), 0.0, 1.0) * (1.0 - cover * 0.85);
  float glow = pow(d, 48.0) * sunGlow + pow(d, 6.0) * sunHaze * (1.0 - cover * 0.5);
  col = mix(col, sunColor, clamp(disc + glow, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}
`;

function displayVector(c: Color): Vector3 {
  const rgb = c.getRGB({ r: 0, g: 0, b: 0 }, SRGBColorSpace);
  return new Vector3(rgb.r, rgb.g, rgb.b);
}

/**
 * per-map sky, fog, exposure, lights and lightmaps. GameApp owns one and calls
 * {@link apply} whenever a map is activated and {@link update} every frame.
 *
 * lightmapped meshes (the ones with a second uv set) switch to MeshBasicMaterial,
 * albedo map x baked light, so the baked sun is not lit a second time. the
 * real-time hemisphere + sun stay for players, weapons and unbaked meshes.
 */
export class MapEnvironment {
  private readonly hemi = new HemisphereLight();
  private readonly sun = new DirectionalLight();
  private readonly fill = new DirectionalLight(0xc7e8ff, 0.45);
  private readonly skyMaterial: ShaderMaterial;
  private readonly skyMesh: Mesh;
  private panorama: Texture | null = null;
  private cloudSpeed = 0;
  private elapsed = 0;
  private resolved: ResolvedEnvironment = resolveEnvironment();

  constructor(private readonly scene: Scene, private readonly renderer: WebGLRenderer) {
    this.sun.castShadow = false;
    this.fill.position.set(-70, 40, -80);
    this.scene.add(this.hemi, this.sun, this.sun.target, this.fill);
    this.skyMaterial = new ShaderMaterial({
      name: 'MapSkyDome',
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      uniforms: {
        zenith: { value: new Vector3() },
        horizon: { value: new Vector3() },
        ground: { value: new Vector3() },
        sunColor: { value: new Vector3() },
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
      },
      side: BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false,
    });
    this.skyMesh = new Mesh(new SphereGeometry(50, 48, 24), this.skyMaterial);
    this.skyMesh.name = 'MapSkyDome';
    this.skyMesh.frustumCulled = false;
    this.skyMesh.renderOrder = -1000;
    this.skyMesh.visible = false;
    this.scene.add(this.skyMesh);
    this.applyResolved(this.resolved);
  }

  public getResolved(): ResolvedEnvironment {
    return this.resolved;
  }

  /** applies the map's environment (or the default one) and swaps in lightmapped materials */
  public apply(map: LoadedMap | null): void {
    const env = resolveEnvironment(map?.meta.environment);
    this.applyResolved(env);
    if (map && env.lightmaps.length > 0 && map.lightmaps && map.lightmaps.length > 0) {
      applyLightmaps(map.sceneRoot, env, map.lightmaps);
    }
    if (map) {
      this.sharpenTextures(map.sceneRoot);
    }
  }

  public update(dt: number, camera: Camera): void {
    this.elapsed += dt;
    if (this.skyMesh.visible) {
      this.skyMesh.position.copy(camera.position);
      this.skyMaterial.uniforms.cloudShift.value = this.elapsed * this.cloudSpeed;
    }
  }

  public dispose(): void {
    this.scene.remove(this.hemi, this.sun, this.sun.target, this.fill, this.skyMesh);
    this.skyMesh.geometry.dispose();
    this.skyMaterial.dispose();
    this.panorama?.dispose();
    this.panorama = null;
  }

  private applyResolved(env: ResolvedEnvironment): void {
    this.resolved = env;
    this.hemi.color.copy(env.hemiSky);
    this.hemi.groundColor.copy(env.hemiGround);
    this.hemi.intensity = env.hemiIntensity;
    this.sun.color.copy(env.sunColor);
    this.sun.intensity = env.sunIntensity;
    this.sun.position.copy(env.sunDirection).multiplyScalar(200);
    this.sun.target.position.set(0, 0, 0);
    this.fill.intensity = env.fillIntensity;
    this.fill.visible = env.fillIntensity > 0;
    this.scene.fog = new Fog(env.fogColor.clone(), env.fogNear, env.fogFar);
    this.renderer.toneMappingExposure = env.exposure;
    this.panorama?.dispose();
    this.panorama = null;

    const sky = env.sky;
    if (!sky) {
      this.skyMesh.visible = false;
      this.scene.background = env.background.clone();
      return;
    }
    if (sky.panorama) {
      this.skyMesh.visible = false;
      this.scene.background = env.fogColor.clone();
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
      return;
    }
    this.scene.background = env.fogColor.clone();
    const u = this.skyMaterial.uniforms;
    (u.zenith.value as Vector3).copy(displayVector(sky.zenith));
    (u.horizon.value as Vector3).copy(displayVector(sky.horizon));
    (u.ground.value as Vector3).copy(displayVector(sky.ground));
    (u.sunColor.value as Vector3).copy(displayVector(env.sunColor));
    (u.sunDir.value as Vector3).copy(env.sunDirection);
    (u.cloudColor.value as Vector3).copy(displayVector(sky.clouds.color));
    (u.cloudShadow.value as Vector3).copy(displayVector(sky.clouds.shadow));
    u.exponent.value = sky.exponent;
    const size = (sky.sunSizeDeg * Math.PI) / 180;
    u.sunOuter.value = Math.cos(size * 1.25);
    u.sunInner.value = Math.cos(size * 0.75);
    u.sunGlow.value = sky.sunGlow;
    u.sunHaze.value = sky.sunHaze;
    u.cloudCoverage.value = sky.clouds.coverage;
    u.cloudScale.value = sky.clouds.scale;
    u.cloudHeight.value = sky.clouds.height;
    this.cloudSpeed = sky.clouds.speed;
    this.skyMesh.visible = true;
  }

  private sharpenTextures(root: Object3D): void {
    const anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
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
 * swaps MeshStandardMaterial for MeshBasicMaterial(map, color, lightMap) on every
 * mesh with a `uv1` attribute. shared materials are converted once. returns how
 * many meshes got a lightmap.
 */
export function applyLightmaps(root: Object3D, env: ResolvedEnvironment, textures: readonly (Texture | null)[]): number {
  const converted = new Map<string, MeshBasicMaterial>();
  const replaced = new Set<Material>();
  let count = 0;
  root.traverse((child) => {
    if (!(child instanceof Mesh) || !child.geometry.getAttribute('uv1')) {
      return;
    }
    const index = lightmapIndexForMesh(child.name, env.lightmaps);
    const texture = index >= 0 ? textures[index] : null;
    if (!texture) {
      return;
    }
    const swap = (material: Material): Material => {
      if (!(material instanceof MeshStandardMaterial)) {
        return material;
      }
      const key = `${material.uuid}:${index}`;
      let basic = converted.get(key);
      if (!basic) {
        basic = new MeshBasicMaterial({
          name: material.name,
          map: material.map,
          color: material.color.clone(),
          lightMap: texture,
          lightMapIntensity: env.lightMapIntensity,
          side: material.side,
          transparent: material.transparent,
          opacity: material.opacity,
          alphaTest: material.alphaTest,
          vertexColors: material.vertexColors,
          fog: true,
        });
        converted.set(key, basic);
        replaced.add(material);
      }
      return basic;
    };
    child.material = Array.isArray(child.material) ? child.material.map(swap) : swap(child.material);
    count += 1;
  });
  for (const material of replaced) {
    material.dispose();
  }
  return count;
}
