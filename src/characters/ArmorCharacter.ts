import {
  Bone,
  Box3,
  Group,
  LOD,
  MathUtils,
  Matrix4,
  Quaternion,
  Skeleton,
  SkinnedMesh,
  Sphere,
  Vector3,
} from 'three';
import type { PlayerModel } from '../network/types';
import { applyKnifeIdlePose, buildArmRig, type ArmRig } from '../multiplayer/playerRig';
import { ArmorMaterial } from './armorMaterial';
import { ARMOR_SLOTS } from './catalog';
import { attachDecals } from './decals';
import { LOD_LEVELS, mergeParts, type CharacterLibrary, type PartMesh } from './library';
import type { CharacterLook } from './look';
import { ALL_JOINTS, buildSkeleton, CAP_HELPERS } from './skeleton';

export type CharacterDetail = 'high' | 'medium' | 'low';

/** camera distances where lod 1 and lod 2 take over, per detail setting */
const LOD_DISTANCES: Record<CharacterDetail, [number, number]> = {
  high: [9, 24],
  medium: [5, 14],
  low: [2.5, 7],
};
let detail: CharacterDetail = 'high';
const live = new Set<ArmorCharacter>();

/** global character detail; lower settings switch to the lighter lods sooner */
export function setCharacterDetail(next: CharacterDetail): void {
  detail = next;
  for (const character of live) character.refreshLodDistances();
}

export function getCharacterDetail(): CharacterDetail {
  return detail;
}

export interface ArmorCharacterOptions {
  pose?: 'stance' | 'none';
  /** pin one level of detail (screenshots, the menu); default switches by distance */
  lod?: 0 | 1 | 2 | 'auto';
}

const BOUNDS = new Sphere(new Vector3(0, 0.95, 0), 1.25);
const BOUNDS_BOX = new Box3(new Vector3(-0.8, -0.05, -0.8), new Vector3(0.8, 2.0, 0.8));
const CAPE = ['cape_0', 'cape_1', 'cape_2', 'cape_3'];
const TAIL = ['tail_0', 'tail_1', 'tail_2'];
const tmpQ = new Quaternion();
const tmpV = new Vector3();
const AXIS_Y = new Vector3(0, 1, 0);
const AXIS_Z = new Vector3(0, 0, 1);

interface ClothBone {
  bone: Bone;
  base: Quaternion;
  swing: number;
  swingVel: number;
  side: number;
  sideVel: number;
}

/**
 * a dressed armored character: the shared skeleton, one skinned mesh per lod
 * merged from the chosen pieces (one draw call), the look's material, decals,
 * and cloth bones that swing with movement. the knife stance comes from the
 * same playerRig pose code as before.
 */
const capRel = new Quaternion();
const capQ = new Quaternion();
const capPivot = new Vector3();
const capUp = new Vector3();
const capDown = new Vector3();

export class ArmorCharacter {
  public readonly root = new Group();
  public readonly rig: ArmRig | null;
  public look: CharacterLook;
  public team: PlayerModel;

  private readonly bones: Map<string, Bone>;
  readonly skeleton: Skeleton;
  private readonly bindWorld = new Map<string, Matrix4>();
  private readonly lod = new LOD();
  private readonly meshes: SkinnedMesh[] = [];
  private readonly material = new ArmorMaterial();
  private readonly cloth: ClothBone[] = [];
  private readonly caps: { name: string; helper: Bone; lower: Bone; child: Bone; bindInv: Quaternion; radius: number; give: number }[] = [];
  private disposeDecals: (() => void) | null = null;
  private piecesKey = '';
  private decalKey = '';
  private readonly velocity = new Vector3();
  private readonly options: ArmorCharacterOptions;

  constructor(private readonly library: CharacterLibrary, look: CharacterLook, team: PlayerModel, options: ArmorCharacterOptions = {}) {
    this.options = options;
    this.look = look;
    this.team = team;
    this.root.name = 'ArmorCharacter';
    this.material.setAtlas(library.atlas);
    this.bones = buildSkeleton(ALL_JOINTS);
    const pelvis = this.bones.get('pelvis')!;
    this.root.add(pelvis);
    this.root.updateMatrixWorld(true);
    for (const [name, bone] of this.bones) this.bindWorld.set(name, bone.matrixWorld.clone());
    this.skeleton = new Skeleton(ALL_JOINTS.map((j) => this.bones.get(j.name)!));
    this.lod.name = 'ArmorLod';
    this.root.add(this.lod);
    for (let level = 0; level < LOD_LEVELS; level += 1) {
      const mesh = new SkinnedMesh(undefined, this.material);
      mesh.name = `ArmorMesh:lod${level}`;
      mesh.frustumCulled = true;
      // a live sun shadow on the lightmapped maps, where the renderer has shadows on
      mesh.castShadow = true;
      this.meshes.push(mesh);
    }
    for (const name of [...CAPE, ...TAIL]) {
      const bone = this.bones.get(name);
      if (bone) this.cloth.push({ bone, base: bone.quaternion.clone(), swing: 0, swingVel: 0, side: 0, sideVel: 0 });
    }
    for (const [name, parent] of Object.entries(CAP_HELPERS)) {
      const helper = this.bones.get(name);
      const lower = this.bones.get(parent);
      const child = lower?.children.find((c): c is Bone => (c as Bone).isBone && c !== helper);
      if (helper && lower && child) this.caps.push({ name, helper, lower, child, bindInv: lower.quaternion.clone().invert(), radius: 0,
        // mpfb spreads the knee blend over a long stretch, so the suit rounds in well past a one joint blend
        give: name.startsWith('knee') ? 2.5 : 1.5 });
    }
    // caps follow whatever posed the rig this frame (idle, swing, remote pose code), right before skinning
    const skeletonUpdate = this.skeleton.update.bind(this.skeleton);
    this.skeleton.update = () => {
      this.updateCaps();
      skeletonUpdate();
    };
    this.rig = buildArmRig(this.root);
    this.setLook(look, team);
    this.refreshLodDistances();
    live.add(this);
  }

  setLook(look: CharacterLook, team: PlayerModel = this.team): void {
    this.look = look;
    this.team = team;
    this.material.applyLook(look, team);
    const key = [look.helmet, look.arms, look.chest, look.legs, look.classItem].join('|');
    if (key !== this.piecesKey) {
      this.piecesKey = key;
      this.rebuildMeshes();
    }
    const decalKey = `${look.chest}|${look.emblem}|${look.tag}|${look.accent}`;
    if (decalKey !== this.decalKey) {
      this.decalKey = decalKey;
      this.disposeDecals?.();
      this.disposeDecals = attachDecals(this.library.anchors, look, this.bones, this.bindWorld);
    }
  }

  /** world-space velocity for the cloth, m/s */
  setVelocity(velocity: Vector3 | readonly [number, number, number]): void {
    if (velocity instanceof Vector3) this.velocity.copy(velocity);
    else this.velocity.set(velocity[0], velocity[1], velocity[2]);
  }

  update(dt: number, nowSec: number): void {
    if (this.rig && this.options.pose !== 'none') {
      applyKnifeIdlePose(this.rig, Math.sin(nowSec * 1.43));
    }
    this.updateCloth(Math.min(dt, 0.05), nowSec);
  }

  /**
   * each cap helper undoes half its joint's bend, so it sits at the mid angle
   * between the two limbs, and sinks into the bend as far as the linearly blended
   * undersuit under it rounds in (a multiple of r (1 - cos(bend / 2))), so no gap opens.
   */
  private updateCaps(): void {
    for (const cap of this.caps) {
      capRel.copy(cap.bindInv).multiply(cap.lower.quaternion).invert();
      cap.helper.quaternion.identity().slerp(capRel, 0.5);
      cap.lower.getWorldPosition(capPivot);
      cap.lower.parent!.getWorldPosition(capUp).sub(capPivot).normalize();
      cap.child.getWorldPosition(capDown).sub(capPivot).normalize();
      const bend = Math.PI - capUp.angleTo(capDown);
      const sink = cap.give * cap.radius * (1 - Math.cos(bend / 2));
      capUp.add(capDown);
      if (capUp.lengthSq() > 1e-8 && sink > 0) {
        // world offset into the lower bone's frame (bones carry no scale)
        cap.lower.getWorldQuaternion(capQ);
        capUp.normalize().multiplyScalar(sink).applyQuaternion(capQ.invert());
        cap.helper.position.copy(capUp);
      } else {
        cap.helper.position.set(0, 0, 0);
      }
      cap.helper.updateMatrixWorld(true);
    }
  }

  /** triangles drawn at a lod, for budgets and tests */
  triangles(level = 0): number {
    const index = this.meshes[level]?.geometry.index;
    return index ? index.count / 3 : 0;
  }

  refreshLodDistances(): void {
    const pinned = this.options.lod;
    this.lod.levels.length = 0;
    for (const mesh of this.meshes) mesh.removeFromParent();
    if (pinned !== undefined && pinned !== 'auto') {
      this.lod.addLevel(this.meshes[pinned], 0);
      return;
    }
    const [d1, d2] = LOD_DISTANCES[detail];
    this.lod.addLevel(this.meshes[0], 0);
    this.lod.addLevel(this.meshes[1], d1);
    this.lod.addLevel(this.meshes[2], d2);
  }

  dispose(): void {
    live.delete(this);
    this.disposeDecals?.();
    this.disposeDecals = null;
    this.material.dispose();
    this.root.removeFromParent();
  }

  private rebuildMeshes(): void {
    for (let level = 0; level < LOD_LEVELS; level += 1) {
      const key = `${this.piecesKey}|${level}`;
      const geometry = this.library.merged(key, () => mergeParts(this.collect(level)));
      const mesh = this.meshes[level];
      geometry.boundingSphere = BOUNDS.clone();
      geometry.boundingBox = BOUNDS_BOX.clone();
      mesh.geometry = geometry;
      // a skinned mesh otherwise skins every vertex on the cpu once to find its bounds
      mesh.boundingSphere = BOUNDS.clone();
      mesh.boundingBox = BOUNDS_BOX.clone();
      // the skeleton's inverses come from the bind pose at construction, so an
      // identity bind matrix is right wherever the root is now
      mesh.bind(this.skeleton, new Matrix4());
    }
    this.measureCaps(this.collect(0));
  }

  /** each cap's centre distance from its pivot, from the plates riding it (sets size their caps differently) */
  private measureCaps(parts: PartMesh[]): void {
    for (const cap of this.caps) {
      const index = this.skeleton.bones.indexOf(cap.helper);
      const pivot = new Vector3().setFromMatrixPosition(this.bindWorld.get(cap.name)!);
      const centre = new Vector3();
      let n = 0;
      for (const part of parts) {
        if (part.skinIndex[0] !== index || part.skinWeight[0] < 0.99) continue;
        for (let i = 0; i < part.position.length; i += 3) {
          centre.x += part.position[i];
          centre.y += part.position[i + 1];
          centre.z += part.position[i + 2];
          n += 1;
        }
      }
      if (n) cap.radius = centre.multiplyScalar(1 / n).distanceTo(pivot);
    }
  }

  private collect(level: number): PartMesh[] {
    const parts: PartMesh[] = [...this.library.get('body', 'core', level)];
    for (const slot of ARMOR_SLOTS) {
      const piece = this.look[slot];
      if (piece === 'none') continue;
      let list = this.library.get(slot, piece, level);
      // a library without this set yet falls back to the house set
      if (list.length === 0) list = this.library.get(slot, 'strafe', level);
      parts.push(...list);
    }
    return parts;
  }

  private updateCloth(dt: number, nowSec: number): void {
    if (this.cloth.length === 0 || dt <= 0) return;
    // velocity in the character's frame (it faces +z)
    this.root.getWorldQuaternion(tmpQ);
    tmpV.copy(this.velocity).applyQuaternion(tmpQ.invert());
    const forward = MathUtils.clamp(tmpV.z / 8, -1, 1.5);
    const lateral = MathUtils.clamp(tmpV.x / 8, -1, 1);
    const falling = MathUtils.clamp(-tmpV.y / 10, -0.6, 1);
    for (let i = 0; i < this.cloth.length; i += 1) {
      const c = this.cloth[i];
      const depth = c.bone.name.startsWith('cape') ? i : i - CAPE.length;
      const idle = Math.sin(nowSec * 1.3 + depth * 0.7) * 0.035 + Math.sin(nowSec * 2.9 + depth) * 0.012;
      const targetSwing = MathUtils.clamp(0.06 + forward * 0.5 + falling * 0.35 + idle, -0.15, 1.1) * (depth === 0 ? 0.6 : 0.35);
      const targetSide = MathUtils.clamp(-lateral * 0.45 + idle * 0.5, -0.45, 0.45) * (depth === 0 ? 0.6 : 0.35);
      // a damped spring per bone, lower bones lag a little more
      const k = 38 - depth * 6;
      const damp = 9 - depth;
      c.swingVel += ((targetSwing - c.swing) * k - c.swingVel * damp) * dt;
      c.swing += c.swingVel * dt;
      c.sideVel += ((targetSide - c.side) * k - c.sideVel * damp) * dt;
      c.side += c.sideVel * dt;
      // cloth bones point down local x; local y is the model's +x and local z its +z
      c.bone.quaternion
        .copy(c.base)
        .multiply(tmpQ.setFromAxisAngle(AXIS_Y, c.swing))
        .multiply(new Quaternion().setFromAxisAngle(AXIS_Z, c.side));
    }
  }
}
