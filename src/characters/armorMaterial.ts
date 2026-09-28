import { Color, DataTexture, MeshStandardMaterial, Vector2, Vector3, type Texture, type WebGLProgramParametersWithUniforms } from 'three';
import { FINISH_INFO, TEAM_GLOW_STRENGTH, TEAM_LIGHT, WORLD_TEAM_LIGHT, type CharacterToneMap, type FinishId } from './catalog';
import type { CharacterLook } from './look';
import { MATERIAL_SLOTS } from './library';
import type { PlayerModel } from '../network/types';

const SLOT_COUNT = MATERIAL_SLOTS.length;
const S = Object.fromEntries(MATERIAL_SLOTS.map((name, i) => [name, i])) as Record<(typeof MATERIAL_SLOTS)[number], number>;

const NEUTRAL_ORM = new DataTexture(new Uint8Array([255, 128, 0, 255]), 1, 1);
NEUTRAL_ORM.needsUpdate = true;

/**
 * one material for a whole character: every vertex carries its material slot
 * (paint, undersuit, rubber, team light, visor, bare metal, cloth), baked ao
 * and an edge wear mask, so recolouring is a uniform update and the merged
 * mesh stays a single draw call. built on MeshStandardMaterial so it takes the
 * scene's lights and environment like everything else.
 */
export class ArmorMaterial extends MeshStandardMaterial {
  /** linear rgb per slot */
  public readonly slotColor: Vector3[] = Array.from({ length: SLOT_COUNT }, () => new Vector3(1, 1, 1));
  /** x roughness, y metalness, z emissive strength */
  public readonly slotPbr: Vector3[] = Array.from({ length: SLOT_COUNT }, () => new Vector3(0.6, 0, 0));
  public readonly wear = { value: 0 };
  public readonly camo = { value: 0 };
  public readonly team = { value: new Color(TEAM_LIGHT.terrorist) };
  /** r ao, g roughness detail around 0.5, b edge wear; neutral until an atlas is set */
  public readonly orm = { value: NEUTRAL_ORM as Texture };

  /**
   * simple: no fine procedural noise (chips, scuffs, weave, camo's second octave).
   * for far lods and the low preset, where that detail is sub pixel and the noise
   * is most of the fragment cost on weak and software gl
   */
  constructor(readonly simple = false) {
    super({ color: 0xffffff, roughness: 1, metalness: 0 });
    this.name = 'ArmorMaterial';
    if (simple) this.defines = { ARMOR_SIMPLE: '' };
    this.onBeforeCompile = (shader) => this.patch(shader);
  }

  // one program for every character, the look lives in uniforms
  override customProgramCacheKey(): string {
    return `armor-v2${this.normalMap ? '-atlas' : ''}${this.simple ? '-simple' : ''}`;
  }

  /** the library's baked atlas; only for geometry that carries atlas uvs */
  setAtlas(atlas: { normal: Texture; orm: Texture } | null): void {
    this.normalMap = atlas?.normal ?? null;
    // gltf-style textures without vertex tangents: three flips green for these
    this.normalScale = new Vector2(1, -1);
    this.orm.value = atlas?.orm ?? NEUTRAL_ORM;
    this.needsUpdate = true;
  }

  applyLook(look: CharacterLook, team: PlayerModel, toneMap: CharacterToneMap = 'grade'): void {
    const finish = FINISH_INFO[look.finish as FinishId] ?? FINISH_INFO.satin;
    const lin = (hex: string) => {
      const c = new Color(hex);
      return new Vector3(c.r, c.g, c.b);
    };
    const teamColor = new Color(TEAM_LIGHT[team]);
    this.team.value.copy(teamColor);
    const primary = lin(look.primary);
    const secondary = lin(look.secondary);
    const accent = lin(look.accent);
    this.slotColor[S.primary].copy(primary);
    this.slotColor[S.secondary].copy(secondary);
    this.slotColor[S.accent].copy(accent);
    // the undersuit is charcoal with a hint of the secondary paint
    this.slotColor[S.suit].set(0.028, 0.03, 0.034).lerp(secondary.clone().multiplyScalar(0.3), 0.15);
    this.slotColor[S.dark].set(0.032, 0.034, 0.038);
    const glow = toneMap === 'aces' ? { color: TEAM_LIGHT[team], strength: TEAM_GLOW_STRENGTH } : WORLD_TEAM_LIGHT[team];
    const light = new Color(glow.color);
    this.slotColor[S.light].set(light.r, light.g, light.b);
    // tinted glass: the accent paint, deep and glossy, so reflections take its colour
    this.slotColor[S.visor].copy(accent).multiplyScalar(0.22).addScalar(0.004);
    this.slotColor[S.metal].set(0.6, 0.61, 0.63);
    this.slotColor[S.cloth].copy(secondary).multiplyScalar(0.85);
    this.slotColor[S.trim].copy(accent).multiplyScalar(0.9);

    const paint = (slot: number, glossier = 0) =>
      this.slotPbr[slot].set(Math.max(0.08, finish.roughness - glossier), finish.metalness, 0);
    paint(S.primary);
    paint(S.secondary, -0.04);
    paint(S.accent, 0.06);
    this.slotPbr[S.suit].set(0.86, 0, 0);
    this.slotPbr[S.dark].set(0.5, 0.25, 0);
    this.slotPbr[S.light].set(0.35, 0, glow.strength);
    this.slotPbr[S.visor].set(0.07, 0.55, 0);
    this.slotPbr[S.metal].set(0.3, 1, 0);
    this.slotPbr[S.cloth].set(0.92, 0, 0);
    this.slotPbr[S.trim].set(0.88, 0, 0);
    this.wear.value = finish.wear;
    this.camo.value = finish.camo ? 1 : 0;
  }

  private patch(shader: WebGLProgramParametersWithUniforms): void {
    shader.uniforms.uSlotColor = { value: this.slotColor };
    shader.uniforms.uSlotPbr = { value: this.slotPbr };
    shader.uniforms.uWear = this.wear;
    shader.uniforms.uCamo = this.camo;
    shader.uniforms.uTeam = this.team;
    shader.uniforms.uOrm = this.orm;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aSlot;
attribute vec2 aOcclusion;
flat varying float vSlot;
varying vec2 vOcc;
varying vec3 vBindPos;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vSlot = aSlot;
vOcc = aOcclusion;
vBindPos = position;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uSlotColor[${SLOT_COUNT}];
uniform vec3 uSlotPbr[${SLOT_COUNT}];
uniform float uWear;
uniform float uCamo;
uniform vec3 uTeam;
uniform sampler2D uOrm;
flat varying float vSlot;
varying vec2 vOcc;
varying vec3 vBindPos;

float armorHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float armorNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(armorHash(i + vec3(0, 0, 0)), armorHash(i + vec3(1, 0, 0)), f.x),
                 mix(armorHash(i + vec3(0, 1, 0)), armorHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(armorHash(i + vec3(0, 0, 1)), armorHash(i + vec3(1, 0, 1)), f.x),
                 mix(armorHash(i + vec3(0, 1, 1)), armorHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
int armorSlot = int(vSlot + 0.5);
vec3 armorPbr = uSlotPbr[armorSlot];
float armorRough = armorPbr.x;
float armorMetal = armorPbr.y;
float armorGlow = armorPbr.z;
vec3 armorColor = uSlotColor[armorSlot];
#ifdef USE_NORMALMAP
vec4 armorOrmA = texture2D(uOrm, vNormalMapUv);
#else
vec4 armorOrmA = vec4(1.0, 0.5, 0.0, 1.0);
#endif
vec3 armorOrm = armorOrmA.rgb;
float armorAo = vOcc.x * armorOrm.r;
float armorEdge = max(vOcc.y, armorOrm.b);
bool armorPaint = armorSlot <= 2;
bool armorFabric = armorSlot == 3 || armorSlot >= 8;
// baked micro roughness: cc0 paint, fabric and leather detail
armorRough = clamp(armorRough + (armorOrm.g - 0.5) * (armorPaint ? 0.55 : 0.8), 0.04, 1.0);
if (armorPaint && uCamo > 0.5) {
  // disruptive pattern in bind space (moves with the body), three paint colours
#ifdef ARMOR_SIMPLE
  float c = armorNoise(vBindPos * vec3(7.0, 5.0, 7.0)) * 0.65 + 0.175;
#else
  float c = armorNoise(vBindPos * vec3(7.0, 5.0, 7.0)) * 0.65 + armorNoise(vBindPos * 17.0) * 0.35;
#endif
  vec3 p0 = uSlotColor[0];
  vec3 p1 = uSlotColor[1];
  vec3 p2 = mix(uSlotColor[2], uSlotColor[1], 0.45);
  armorColor = c < 0.44 ? p0 : (c < 0.58 ? p1 : p2);
}
if (armorPaint) {
  // worn finish: paint chips off along the sharp edges, a few scratches elsewhere
  float edge = smoothstep(0.35, 0.8, armorEdge);
#ifdef ARMOR_SIMPLE
  // the chips' average coverage, without the noise
  float bare = edge * 0.45 * max(uWear, 0.14);
#else
  float n1 = armorNoise(vBindPos * 60.0);
  float n2 = armorNoise(vBindPos * 210.0);
  armorRough = clamp(armorRough + (n1 - 0.5) * 0.05, 0.04, 1.0);
  // every finish chips a little on its sharpest edges; worn goes much further
  float chip = edge * smoothstep(0.35, 0.6, armorNoise(vBindPos * 150.0) + (n1 - 0.5) * 0.3) * max(uWear, 0.14);
  float scuff = smoothstep(0.86, 0.95, n2) * 0.3 * uWear;
  float bare = max(chip, scuff);
#endif
  armorColor = mix(armorColor, vec3(0.5, 0.49, 0.47), bare);
  armorMetal = mix(armorMetal, 0.85, bare);
  armorRough = mix(armorRough, 0.34, bare);
  armorColor *= mix(1.0, 0.72 + 0.28 * armorAo, uWear);
  // every finish: a faint lighter rim on the bevels catches light like real edge wear
  armorColor *= 1.0 + 0.12 * smoothstep(0.4, 0.9, armorEdge);
}
#ifndef ARMOR_SIMPLE
else if (armorFabric) {
  float weave = armorNoise(vBindPos * 380.0);
  armorColor *= 0.9 + 0.2 * weave;
}
#endif
// baked grime: cavity dirt and run-off streaks (stronger on worn paint)
if (armorSlot != 5 && armorSlot != 6) {
  float grime = mix(0.42, 1.0, smoothstep(0.62, 0.98, armorOrmA.a));
  armorColor *= mix(1.0, grime, armorPaint ? 0.85 + 0.15 * uWear : 0.6);
}
diffuseColor.rgb = armorColor;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = armorRough;`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
metalnessFactor = armorMetal;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance = armorColor * armorGlow;
if (armorSlot == 6) {
  // visor glass: tinted, with a faint team glow behind it and a brighter rim at glancing angles
  float vf = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 2.0);
  totalEmissiveRadiance = armorColor * 0.35 + uTeam * (0.015 + 0.08 * vf);
}
if (armorFabric) {
  // soft sheen at grazing angles so cloth reads as cloth
  float fres = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0);
  totalEmissiveRadiance += armorColor * fres * 0.18;
}`,
      )
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
reflectedLight.indirectDiffuse *= armorAo;
reflectedLight.indirectSpecular *= mix(0.35, 1.0, armorAo);
reflectedLight.directDiffuse *= mix(0.62, 1.0, armorAo);
#if !defined( USE_ENVMAP ) && NUM_HEMI_LIGHTS > 0
{
  // no environment map in this scene: fake one from the hemisphere light so metal isn't black
  vec3 rdir = inverseTransformDirection(reflect(-normalize(vViewPosition), normal), viewMatrix);
  vec3 sky = mix(hemisphereLights[0].groundColor, hemisphereLights[0].skyColor, rdir.y * 0.5 + 0.5);
  vec3 spec = mix(vec3(0.04), armorColor, armorMetal);
  reflectedLight.indirectSpecular += sky * spec * (1.0 - armorRough * 0.75) * armorAo;
}
#endif`,
      );
  }
}
