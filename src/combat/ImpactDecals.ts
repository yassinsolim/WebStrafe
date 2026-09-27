import {
  DataTexture,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  RGBAFormat,
  Vector3,
  type Object3D,
} from 'three';

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
const DEFAULT_HOLD_MS = 12000;
const DEFAULT_FADE_MS = 3000;
/** lifts the quad off the surface; polygon offset handles the rest */
const SURFACE_LIFT_M = 0.004;
const TEXTURE_SIZE = 32;
const Z_AXIS = new Vector3(0, 0, 1);

interface DecalSlot {
  mesh: Mesh;
  material: MeshBasicMaterial;
  bornMs: number;
  active: boolean;
}

/**
 * Pooled bullet holes: small oriented quads laid on world geometry at impact
 * points, at most `maxDecals` alive, each holding and then fading out. Meshes
 * and materials are reused, so a long fight allocates nothing after warm-up.
 */
export class ImpactDecals {
  private readonly slots: DecalSlot[] = [];
  private nextSlot = 0;
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly texture = createHoleTexture();
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

  spawn(point: Vector3, normal: Vector3, sizeM: number, nowMs: number): void {
    if (!isFinite3(point) || !isFinite3(normal) || normal.lengthSq() < 1e-8 || !(sizeM > 0)) {
      return;
    }
    const slot = this.acquire();
    const facing = normal.clone().normalize();
    const mesh = slot.mesh;
    mesh.quaternion.setFromUnitVectors(Z_AXIS, facing);
    // random spin around the normal so repeated holes don't look stamped
    mesh.quaternion.multiply(this.tmpQuat.setFromAxisAngle(Z_AXIS, this.random() * Math.PI * 2));
    mesh.position.copy(point).addScaledVector(facing, SURFACE_LIFT_M);
    mesh.scale.set(sizeM, sizeM, 1);
    mesh.visible = true;
    slot.material.opacity = 1;
    slot.bornMs = nowMs;
    slot.active = true;
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
    this.texture.dispose();
  }

  private acquire(): DecalSlot {
    if (this.slots.length < this.maxDecals) {
      const material = new MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        depthWrite: false,
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

/** dark punched hole with a lighter chipped rim, generated once */
function createHoleTexture(): DataTexture {
  const pixels = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * 4);
  let seed = 0x5eed;
  const noise = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let y = 0; y < TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < TEXTURE_SIZE; x += 1) {
      const dx = ((x + 0.5) / TEXTURE_SIZE) * 2 - 1;
      const dy = ((y + 0.5) / TEXTURE_SIZE) * 2 - 1;
      const r = Math.hypot(dx, dy) + (noise() - 0.5) * 0.08;
      let shade = 18;
      let alpha = 0;
      if (r < 0.32) {
        shade = 12;
        alpha = 1;
      } else if (r < 0.5) {
        shade = 58;
        alpha = 0.85;
      } else if (r < 0.78) {
        shade = 44;
        alpha = Math.max(0, 0.55 - (r - 0.5) * 2) * (noise() > 0.35 ? 1 : 0.3);
      }
      const offset = (y * TEXTURE_SIZE + x) * 4;
      pixels[offset] = shade;
      pixels[offset + 1] = shade - 2;
      pixels[offset + 2] = shade - 4;
      pixels[offset + 3] = Math.round(alpha * 255);
    }
  }
  const texture = new DataTexture(pixels, TEXTURE_SIZE, TEXTURE_SIZE, RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

function isFinite3(v: Vector3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}
