import { Color, MeshStandardMaterial, Vector3, type WebGLProgramParametersWithUniforms } from 'three';
import { FINISH_INFO, TEAM_LIGHT, type FinishId } from './catalog';
import type { CharacterLook } from './look';
import { MATERIAL_SLOTS } from './library';
import type { PlayerModel } from '../network/types';

const SLOT_COUNT = MATERIAL_SLOTS.length;
const S = Object.fromEntries(MATERIAL_SLOTS.map((name, i) => [name, i])) as Record<(typeof MATERIAL_SLOTS)[number], number>;

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
  public readonly team = { value: new Color(TEAM_LIGHT.terrorist) };

  constructor() {
    super({ color: 0xffffff, roughness: 1, metalness: 0 });
    this.name = 'ArmorMaterial';
    this.onBeforeCompile = (shader) => this.patch(shader);
  }

  // one program for every character, the look lives in uniforms
  override customProgramCacheKey(): string {
    return 'armor-v1';
  }

  applyLook(look: CharacterLook, team: PlayerModel): void {
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
    // the undersuit is a dark take on the secondary paint
    this.slotColor[S.suit].copy(secondary).multiplyScalar(0.22).addScalar(0.018);
    this.slotColor[S.dark].set(0.032, 0.034, 0.038);
    this.slotColor[S.light].set(teamColor.r, teamColor.g, teamColor.b);
    this.slotColor[S.visor].set(0.012, 0.014, 0.018).lerp(new Vector3(teamColor.r, teamColor.g, teamColor.b), 0.06);
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
    this.slotPbr[S.light].set(0.35, 0, 3.2);
    this.slotPbr[S.visor].set(0.07, 0.25, 0.22);
    this.slotPbr[S.metal].set(0.3, 1, 0);
    this.slotPbr[S.cloth].set(0.92, 0, 0);
    this.slotPbr[S.trim].set(0.88, 0, 0);
    this.wear.value = finish.wear;
  }

  private patch(shader: WebGLProgramParametersWithUniforms): void {
    shader.uniforms.uSlotColor = { value: this.slotColor };
    shader.uniforms.uSlotPbr = { value: this.slotPbr };
    shader.uniforms.uWear = this.wear;
    shader.uniforms.uTeam = this.team;

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
uniform vec3 uTeam;
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
float armorAo = vOcc.x;
bool armorPaint = armorSlot <= 2;
bool armorFabric = armorSlot == 3 || armorSlot >= 8;
if (armorPaint) {
  float n1 = armorNoise(vBindPos * 60.0);
  float n2 = armorNoise(vBindPos * 210.0);
  armorRough = clamp(armorRough + (n1 - 0.5) * 0.08, 0.05, 1.0);
  // worn finish: paint chips off the sharp edges and scuffs a little elsewhere
  float chip = smoothstep(0.42, 0.62, vOcc.y + (n1 - 0.5) * 0.5 + (n2 - 0.5) * 0.25) * uWear;
  float scuff = smoothstep(0.7, 0.95, n2) * 0.25 * uWear;
  float bare = max(chip, scuff * (1.0 - armorAo));
  armorColor = mix(armorColor, vec3(0.5, 0.49, 0.47), bare);
  armorMetal = mix(armorMetal, 0.85, bare);
  armorRough = mix(armorRough, 0.34, bare);
  armorColor *= mix(1.0, 0.72 + 0.28 * armorAo, uWear);
} else if (armorFabric) {
  float weave = armorNoise(vBindPos * 380.0);
  armorColor *= 0.9 + 0.2 * weave;
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
