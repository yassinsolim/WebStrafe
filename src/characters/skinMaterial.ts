import { Color, MeshStandardMaterial, Vector2, Vector3, type Texture, type WebGLProgramParametersWithUniforms } from 'three';
import { FINISH_INFO, isSkinId, SKIN_INFO, TEAM_GLOW_STRENGTH, TEAM_LIGHT, WORLD_TEAM_LIGHT, type CharacterToneMap, type FinishId } from './catalog';
import type { CharacterLook } from './look';
import type { SkinAsset } from './skins';
import type { PlayerModel } from '../network/types';

/**
 * a whole-body skin's material: the artist's atlas (albedo, normals, glow /
 * roughness / metalness) with three paint zones from the mask. a zone whose
 * look colour is the skin's own shows the art untouched; any other colour
 * repaints it, keeping the art's shading and grime by scaling the paint with
 * the texel's luminance over the zone's mean. the glow takes the team light
 * like the kit's lights, so teams stay readable.
 */
export class SkinMaterial extends MeshStandardMaterial {
  private readonly paint = { value: [new Vector3(), new Vector3(), new Vector3()] };
  private readonly paintOn = { value: new Vector3() };
  private readonly nativeLum = { value: new Vector3(1, 1, 1) };
  private readonly glow = { value: new Color() };
  /** x roughness scale on painted zones, y metalness there (< 0 keeps the art's) */
  private readonly finish = { value: new Vector2(1, -1) };
  private readonly maskMap = { value: null as Texture | null };
  private readonly dataMap = { value: null as Texture | null };
  /** roughness floor for non-metal texels, 0 keeps the art's gloss */
  private readonly matte = { value: 0 };

  constructor() {
    super({ color: 0xffffff, roughness: 1, metalness: 1 });
    this.name = 'SkinMaterial';
    this.onBeforeCompile = (shader) => this.patch(shader);
  }

  override customProgramCacheKey(): string {
    return `skin-v1${this.normalMap ? '-n' : ''}`;
  }

  /** the skin's atlas; normals off for the low detail setting */
  setSkin(skin: SkinAsset, normals = true): void {
    const tex = skin.textures;
    this.map = tex?.color ?? null;
    this.normalMap = normals ? tex?.normal ?? null : null;
    // gltf normal maps without vertex tangents: three flips green for these
    this.normalScale = new Vector2(1, -1);
    this.roughnessMap = tex?.data ?? null;
    this.metalnessMap = tex?.data ?? null;
    this.maskMap.value = tex?.mask ?? null;
    this.dataMap.value = tex?.data ?? null;
    const lum = SKIN_INFO[skin.id].luminance;
    this.nativeLum.value.set(lum[0], lum[1], lum[2]);
    this.needsUpdate = true;
  }

  /**
   * lifts the art's roughness towards a floor on everything but bare metal, so
   * glossy gloves read as fabric and leather up close in first person
   */
  setMatte(floor: number): void {
    this.matte.value = Math.min(Math.max(floor, 0), 0.95);
  }

  applyLook(look: CharacterLook, team: PlayerModel, toneMap: CharacterToneMap = 'grade'): void {
    const native = isSkinId(look.skin) ? SKIN_INFO[look.skin].native : null;
    const zone = (index: number, hex: string, own: string | undefined) => {
      const c = new Color(hex);
      this.paint.value[index].set(c.r, c.g, c.b);
      return own && own.toLowerCase() === hex.toLowerCase() ? 0 : 1;
    };
    this.paintOn.value.set(
      zone(0, look.primary, native?.primary),
      zone(1, look.secondary, native?.secondary),
      zone(2, look.accent, native?.accent),
    );
    const glow = toneMap === 'aces' ? { color: TEAM_LIGHT[team], strength: TEAM_GLOW_STRENGTH } : WORLD_TEAM_LIGHT[team];
    this.glow.value.set(glow.color).multiplyScalar(glow.strength);
    const finish = FINISH_INFO[look.finish as FinishId] ?? FINISH_INFO.satin;
    // the art is satin; the other finishes push the painted zones from there
    const rough = { matte: 1.3, satin: 1, gloss: 0.55, metallic: 0.75, worn: 1.1, camo: 1.15 }[finish.id];
    this.finish.value.set(rough, finish.id === 'metallic' ? 0.9 : finish.id === 'matte' ? 0.1 : -1);
  }

  private patch(shader: WebGLProgramParametersWithUniforms): void {
    shader.uniforms.uSkinMask = this.maskMap;
    shader.uniforms.uSkinData = this.dataMap;
    shader.uniforms.uPaint = this.paint;
    shader.uniforms.uPaintOn = this.paintOn;
    shader.uniforms.uNativeLum = this.nativeLum;
    shader.uniforms.uGlow = this.glow;
    shader.uniforms.uFinish = this.finish;
    shader.uniforms.uMatte = this.matte;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D uSkinMask;
uniform sampler2D uSkinData;
uniform vec3 uPaint[3];
uniform vec3 uPaintOn;
uniform vec3 uNativeLum;
uniform vec3 uGlow;
uniform vec2 uFinish;
uniform float uMatte;`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
#ifdef USE_MAP
  vec3 skinZones = texture2D(uSkinMask, vMapUv).rgb;
#else
  vec3 skinZones = vec3(0.0);
#endif
  vec3 skinMix = skinZones * uPaintOn;
  float skinLum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 skinShade = clamp(vec3(skinLum) / max(uNativeLum, vec3(1e-4)), 0.0, 2.2);
  diffuseColor.rgb = mix(diffuseColor.rgb, uPaint[0] * skinShade.x, skinMix.r);
  diffuseColor.rgb = mix(diffuseColor.rgb, uPaint[1] * skinShade.y, skinMix.g);
  diffuseColor.rgb = mix(diffuseColor.rgb, uPaint[2] * skinShade.z, skinMix.b);
  float skinPainted = clamp(skinZones.r + skinZones.g + skinZones.b, 0.0, 1.0);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
  roughnessFactor = mix(roughnessFactor, clamp(roughnessFactor * uFinish.x, 0.06, 1.0), skinPainted);`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
  if (uFinish.y >= 0.0) metalnessFactor = mix(metalnessFactor, uFinish.y, skinPainted);
  if (uMatte > 0.0) roughnessFactor = mix(uMatte + (1.0 - uMatte) * roughnessFactor, roughnessFactor, metalnessFactor * 0.7);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
#ifdef USE_MAP
  // lossy webp shares chroma between channels, so the busy roughness and metal
  // leak up to ~0.3 into the glow (measured); real lights sit at one
  totalEmissiveRadiance += uGlow * smoothstep(0.35, 0.65, texture2D(uSkinData, vMapUv).r);
#endif`,
      );
  }
}
