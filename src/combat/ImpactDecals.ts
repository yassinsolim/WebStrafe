import {
  Color,
  CustomBlending,
  DstColorFactor,
  Mesh,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Vector3,
  ZeroFactor,
  type DataTexture,
  type Object3D,
} from 'three';
import type { SurfaceKind } from '../render/worldMaterials';
import { createDecalTexture } from './effects/textures';

export interface ImpactDecalOptions {
  /** pool size; the oldest hole is reused once it is full */
  maxDecals?: number;
  /** full opacity time, ms */
  holdMs?: number;
  /** fade out time after the hold, ms */
  fadeMs?: number;
  random?: () => number;
}

export const DEFAULT_MAX_DECALS = 64;
const DEFAULT_HOLD_MS = 15000;
const DEFAULT_FADE_MS = 3000;
/** lifts the quad off the surface; polygon offset handles the rest */
const SURFACE_LIFT_M = 0.004;
const Z_AXIS = new Vector3(0, 0, 1);

const VERTEX = /* glsl */ `
varying vec2 vUv;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

// multiply blend: the framebuffer (already lit, shadowed and fogged) is scaled
// by the texture, so a hole in the shade is as dark as the shade around it
const FRAGMENT = /* glsl */ `
uniform sampler2D map;
uniform float strength;
varying vec2 vUv;
#include <fog_pars_fragment>
void main() {
  vec3 m = texture2D(map, vUv).rgb * 2.0;
  m = mix(vec3(1.0), m, strength);
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  m = mix(m, vec3(1.0), fogFactor);
#endif
  gl_FragColor = vec4(m, 1.0);
}
`;

interface DecalSlot {
  mesh: Mesh;
  material: ShaderMaterial;
  bornMs: number;
  active: boolean;
}

/**
 * Pooled bullet holes: small oriented quads laid on world geometry at impact
 * points, at most `maxDecals` alive, each holding and then fading out. They
 * multiply the lit surface under them, one texture per surface kind (metal
 * gets a bright rim, concrete a chipped crater, sand a soft dent). Meshes and
 * materials are reused, so a long fight allocates nothing after warm-up.
 */
export class ImpactDecals {
  private readonly slots: DecalSlot[] = [];
  private nextSlot = 0;
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly textures = new Map<SurfaceKind, DataTexture>();
  private readonly maxDecals: number;
  private readonly holdMs: number;
  private readonly fadeMs: number;
  private readonly random: () => number;
  private readonly tmpQuat = new Quaternion();

  constructor(private readonly parent: Object3D, options: ImpactDecalOptions = {}) {
    this.maxDecals = Math.max(1, Math.floor(options.maxDecals ?? DEFAULT_MAX_DECALS));
    this.holdMs = Math.max(0, options.holdMs ?? DEFAULT_HOLD_MS);
    this.fadeMs = Math.max(1, options.fadeMs ?? DEFAULT_FADE_MS);
    this.random = options.random ?? Math.random;
  }

  spawn(point: Vector3, normal: Vector3, sizeM: number, nowMs: number, surface: SurfaceKind = 'generic'): void {
    if (!isFinite3(point) || !isFinite3(normal) || normal.lengthSq() < 1e-8 || !(sizeM > 0)) {
      return;
    }
    if (surface === 'emissive') {
      return;
    }
    const slot = this.acquire();
    const facing = normal.clone().normalize();
    const mesh = slot.mesh;
    mesh.quaternion.setFromUnitVectors(Z_AXIS, facing);
    // random spin around the normal so repeated holes don't look stamped
    mesh.quaternion.multiply(this.tmpQuat.setFromAxisAngle(Z_AXIS, this.random() * Math.PI * 2));
    mesh.position.copy(point).addScaledVector(facing, SURFACE_LIFT_M);
    // sand dents spread wider than a clean hole in steel
    const scale = surface === 'sand' ? 1.5 : surface === 'metal' ? 0.85 : 1;
    mesh.scale.set(sizeM * scale, sizeM * scale, 1);
    mesh.visible = true;
    slot.material.uniforms.map.value = this.texture(surface);
    slot.material.opacity = 1;
    slot.material.uniforms.strength.value = 1;
    slot.bornMs = nowMs;
    slot.active = true;
    mesh.userData.surface = surface;
    if (mesh.parent !== this.parent) {
      this.parent.add(mesh);
    }
  }

  update(nowMs: number): void {
    for (const slot of this.slots) {
      if (!slot.active) continue;
      const age = nowMs - slot.bornMs;
      if (age >= this.holdMs + this.fadeMs) {
        this.deactivate(slot);
      } else if (age > this.holdMs) {
        slot.material.opacity = 1 - (age - this.holdMs) / this.fadeMs;
        slot.material.uniforms.strength.value = slot.material.opacity;
      }
    }
  }

  getActiveCount(): number {
    return this.slots.filter((slot) => slot.active).length;
  }

  clear(): void {
    for (const slot of this.slots) {
      this.deactivate(slot);
    }
  }

  dispose(): void {
    this.clear();
    for (const slot of this.slots) {
      slot.material.dispose();
    }
    this.slots.length = 0;
    this.geometry.dispose();
    for (const texture of this.textures.values()) texture.dispose();
    this.textures.clear();
  }

  private texture(kind: SurfaceKind): DataTexture {
    const key: SurfaceKind = kind === 'stone' ? 'concrete' : kind;
    let texture = this.textures.get(key);
    if (!texture) {
      texture = createDecalTexture(key);
      this.textures.set(key, texture);
    }
    return texture;
  }

  private acquire(): DecalSlot {
    if (this.slots.length < this.maxDecals) {
      const material = new ShaderMaterial({
        name: 'ImpactDecal',
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: {
          map: { value: null },
          strength: { value: 1 },
          fogColor: { value: new Color() },
          fogNear: { value: 1 },
          fogFar: { value: 1000 },
          fogDensity: { value: 0 },
        },
        fog: true,
        transparent: true,
        depthWrite: false,
        blending: CustomBlending,
        blendSrc: DstColorFactor,
        blendDst: ZeroFactor,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      });
      const mesh = new Mesh(this.geometry, material);
      mesh.name = 'ImpactDecal';
      mesh.userData.effectType = 'decal';
      mesh.renderOrder = 1;
      mesh.matrixAutoUpdate = true;
      const slot: DecalSlot = { mesh, material, bornMs: 0, active: false };
      this.slots.push(slot);
      return slot;
    }
    // the ring order is spawn order, so this is always the oldest hole
    const slot = this.slots[this.nextSlot];
    this.nextSlot = (this.nextSlot + 1) % this.maxDecals;
    return slot;
  }

  private deactivate(slot: DecalSlot): void {
    slot.active = false;
    slot.mesh.visible = false;
    slot.mesh.parent?.remove(slot.mesh);
  }
}

function isFinite3(v: Vector3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}
