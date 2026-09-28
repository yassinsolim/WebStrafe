import {
  Color,
  Matrix3,
  Matrix4,
  MeshStandardMaterial,
  Object3D,
  SkinnedMesh,
  Vector3,
} from 'three';
import { ArmorMaterial } from './armorMaterial';
import { ARMOR_SET_INFO, ARMOR_SETS } from './catalog';
import { loadCharacterLibrary } from './CharacterFactory';
import { FP_PART, transplantArms, type ArmsSurface } from './fpTransplant';
import { mergeParts, type CharacterLibrary } from './library';
import type { CharacterLook } from './look';

// linear average of the arms atlas regions (tools/blender/arms/texture.py), used to
// retint the baked sleeve so its average lands on the wanted colour
const SLEEVE_AVERAGE = new Color().setRGB(0.089, 0.1, 0.051);

const LANDMARKS = ['upperarm', 'forearm', 'hand', 'middle_01', 'index_01', 'pinky_01'];

interface ArmsMaterial {
  material: MeshStandardMaterial;
  base: Color;
}

/**
 * dresses the shared first-person arms rig in the player's armor: the kit's own
 * third-person forearm, elbow and hand plates, transplanted onto the arms
 * (fpTransplant.ts) so they share the atlas, finish and colours other players
 * see. the sleeve is retinted to the look and the wristwatch rides on top of
 * whatever covers the wrist.
 */
export class FirstPersonArmor {
  private readonly material = new ArmorMaterial();
  private readonly bySet = new Map<string, SkinnedMesh>();
  private readonly watchLift = new Map<string, number>();
  private look: CharacterLook | null = null;
  private sleeve: ArmsMaterial | null = null;
  private glove: ArmsMaterial | null = null;
  private skin: ArmsMaterial | null = null;
  private watch: Object3D | null = null;
  private watchRest = new Vector3();
  private watchUp = new Vector3(0, 1, 0);

  attach(armsRoot: Object3D, library: Promise<CharacterLibrary | null> = loadCharacterLibrary()): Promise<void> {
    const armsMeshes: SkinnedMesh[] = [];
    armsRoot.traverse((node) => {
      const mesh = node as SkinnedMesh;
      if (mesh.isSkinnedMesh && !mesh.name.startsWith('FirstPersonArmor')) armsMeshes.push(mesh);
      if ((mesh as unknown as { isMesh?: boolean }).isMesh) {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of materials) {
          if (!(m instanceof MeshStandardMaterial)) continue;
          if (m.name === 'mat_sleeve') this.sleeve ??= { material: m, base: m.color.clone() };
          if (m.name === 'mat_glove') this.glove ??= { material: m, base: m.color.clone() };
          if (m.name === 'mat_skin') this.skin ??= { material: m, base: m.color.clone() };
        }
      }
    });
    this.watch = armsRoot.getObjectByName('watch') ?? null;
    if (this.watch) {
      this.watchRest.copy(this.watch.position);
      // the dial normal is the watch's local +y; lift along it in the parent's space
      this.watchUp.set(0, 1, 0).applyQuaternion(this.watch.quaternion).normalize();
    }
    const skinned = armsMeshes[0];
    if (!skinned) return Promise.resolve();
    armsRoot.updateMatrixWorld(true);
    // glove, skin and sleeve are separate meshes on one skeleton
    const surface = armsSurface(armsMeshes.filter((m) => m.skeleton.bones[0] === skinned.skeleton.bones[0]));
    const watchBind = this.watch ? watchInBind(this.watch, skinned) : null;

    return library
      .then((lib) => {
        if (!lib) return;
        this.material.setAtlas(lib.atlas);
        const body = lib.get('body', 'core', 0).filter((p) => p.part === 'suit');
        const toLocal = skinned.bindMatrixInverse;
        const normalToLocal = new Matrix3().getNormalMatrix(toLocal);
        for (const set of ARMOR_SETS) {
          const pieces = lib.get('arms', set, 0).filter((p) => FP_PART.test(p.part));
          if (!pieces.length) continue;
          const moved = transplantArms(pieces, body, surface);
          if (watchBind) this.watchLift.set(set, liftOver(moved, watchBind.position, watchBind.up));
          const v = new Vector3();
          for (const part of moved) {
            for (let i = 0; i < part.position.length; i += 3) {
              v.fromArray(part.position, i).applyMatrix4(toLocal).toArray(part.position, i);
              v.fromArray(part.normal, i).applyMatrix3(normalToLocal).normalize().toArray(part.normal, i);
            }
          }
          const mesh = new SkinnedMesh(mergeParts(moved), this.material);
          mesh.name = `FirstPersonArmor:${set}`;
          mesh.frustumCulled = false;
          mesh.visible = false;
          mesh.position.copy(skinned.position);
          mesh.quaternion.copy(skinned.quaternion);
          mesh.scale.copy(skinned.scale);
          mesh.renderOrder = skinned.renderOrder;
          (skinned.parent ?? armsRoot).add(mesh);
          mesh.bind(skinned.skeleton, skinned.bindMatrix);
          this.bySet.set(set, mesh);
        }
        if (this.look) this.setLook(this.look);
      })
      .catch((error: unknown) => {
        // eslint-disable-next-line no-console
        console.warn('[Characters] first-person armor failed to build:', error);
      });
  }

  setLook(look: CharacterLook): void {
    this.look = look;
    this.material.applyLook(look, 'terrorist');
    for (const [set, mesh] of this.bySet) mesh.visible = set === look.arms;
    const info = ARMOR_SET_INFO[look.arms];
    const secondary = new Color(look.secondary);
    // gauntlet sets wear a dark undersuit sleeve, sleeve sets show the cloth colour
    const sleeveTarget = info.firstPerson === 'sleeves'
      ? secondary.clone().multiplyScalar(0.85)
      : new Color(0.028, 0.03, 0.034).lerp(secondary.clone().multiplyScalar(0.3), 0.3);
    if (this.sleeve) {
      this.sleeve.material.color.setRGB(
        sleeveTarget.r / SLEEVE_AVERAGE.r,
        sleeveTarget.g / SLEEVE_AVERAGE.g,
        sleeveTarget.b / SLEEVE_AVERAGE.b,
      );
    }
    // the bare forearm between glove and sleeve becomes the dark undersuit under the plates
    if (this.skin && this.bySet.size) this.skin.material.color.setRGB(0.055, 0.065, 0.085);
    // the baked glove keeps its own charcoal and grey pads; tinting it washes the pads out
    if (this.watch) {
      this.watch.visible = look.watch;
      this.watch.position.copy(this.watchRest).addScaledVector(this.watchUp, this.watchLift.get(look.arms) ?? 0);
    }
  }

  /** the built first-person mesh of a set (tests, tooling) */
  meshFor(set: string): SkinnedMesh | null {
    return this.bySet.get(set) ?? null;
  }

  /** the arms' own materials back to how they loaded (tests, disposal) */
  reset(): void {
    if (this.sleeve) this.sleeve.material.color.copy(this.sleeve.base);
    if (this.glove) this.glove.material.color.copy(this.glove.base);
    if (this.skin) this.skin.material.color.copy(this.skin.base);
    for (const mesh of this.bySet.values()) mesh.visible = false;
    if (this.watch) {
      this.watch.visible = true;
      this.watch.position.copy(this.watchRest);
    }
  }
}

/** the arms meshes and their landmark joints in bind space, whatever pose the rig is in now */
function armsSurface(meshes: SkinnedMesh[]): ArmsSurface {
  const arms = meshes[0];
  const count = meshes.reduce((n, m) => n + m.geometry.getAttribute('position').count, 0);
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  const v = new Vector3();
  let o = 0;
  for (const mesh of meshes) {
    const geo = mesh.geometry;
    const pos = geo.getAttribute('position');
    const nrm = geo.getAttribute('normal');
    const si = geo.getAttribute('skinIndex');
    const sw = geo.getAttribute('skinWeight');
    const normalMatrix = new Matrix3().getNormalMatrix(mesh.bindMatrix);
    for (let i = 0; i < pos.count; i += 1, o += 1) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.bindMatrix).toArray(position, o * 3);
      v.fromBufferAttribute(nrm, i).applyMatrix3(normalMatrix).normalize().toArray(normal, o * 3);
      for (let k = 0; k < 4; k += 1) {
        skinIndex[o * 4 + k] = si.getComponent(i, k);
        skinWeight[o * 4 + k] = sw.getComponent(i, k);
      }
    }
  }
  const boneIndex = new Map(arms.skeleton.bones.map((b, i) => [b.name, i]));
  const joints = new Map<string, Vector3>();
  const inv = new Matrix4();
  for (const side of ['l', 'r']) {
    for (const name of LANDMARKS) {
      const i = boneIndex.get(`${name}_${side}`);
      if (i === undefined) throw new Error(`arms rig has no ${name}_${side}`);
      inv.copy(arms.skeleton.boneInverses[i]).invert();
      joints.set(`${name}_${side}`, new Vector3().setFromMatrixPosition(inv));
    }
  }
  return { position, normal, skinIndex, skinWeight, boneIndex, joints };
}

/** the watch dial's centre and normal in the arms' bind space (the rig is at rest when attached) */
function watchInBind(watch: Object3D, arms: SkinnedMesh): { position: Vector3; up: Vector3 } {
  const toBind = arms.bindMatrix.clone().multiply(arms.matrixWorld.clone().invert());
  const position = watch.getWorldPosition(new Vector3()).applyMatrix4(toBind);
  const up = new Vector3(0, 1, 0).transformDirection(watch.matrixWorld).transformDirection(toBind);
  return { position, up };
}

/** how far the watch has to rise to sit on the armor around it */
function liftOver(parts: { position: Float32Array }[], centre: Vector3, up: Vector3): number {
  let top = 0;
  const v = new Vector3();
  for (const part of parts) {
    for (let i = 0; i < part.position.length; i += 3) {
      v.fromArray(part.position, i).sub(centre);
      const h = v.dot(up);
      const lateral = Math.sqrt(Math.max(0, v.lengthSq() - h * h));
      if (lateral < 0.022 && h > top) top = h;
    }
  }
  return Math.min(0.03, top > 0 ? top - 0.002 : 0);
}
