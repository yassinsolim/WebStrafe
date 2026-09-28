import {
  Bone,
  Color,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Skeleton,
  SkinnedMesh,
  Vector3,
} from 'three';
import { sharedGltfLoader } from '../assets/gltfLoader';
import { ArmorMaterial } from './armorMaterial';
import { ARMOR_SET_INFO, type ArmorSetId } from './catalog';
import { extractPart, mergeParts, type PartMesh } from './library';
import type { CharacterLook } from './look';

export const FP_ARMOR_URL = '/characters/fp_armor.glb';

// linear average of the arms atlas regions (tools/blender/arms/texture.py), used to
// retint the baked sleeve so its average lands on the wanted colour
const SLEEVE_AVERAGE = new Color().setRGB(0.089, 0.1, 0.051);

/** how far the watch lifts off the wrist so it rides on top of each set's forearm armor */
const WATCH_LIFT_M: Record<ArmorSetId, number> = {
  strafe: 0.0105,
  anvil: 0.0148,
  vector: 0.0062,
  quill: 0.0112,
};

interface ArmsMaterial {
  material: MeshStandardMaterial;
  base: Color;
}

/**
 * dresses the shared first-person arms rig in the player's armor: each set's
 * gauntlets or sleeves (public/characters/fp_armor.glb) skinned onto the same
 * bones, the baked glove and sleeve retinted to the look, and the wristwatch
 * shown or hidden and lifted over the armor.
 *
 * attach() has to run while the rig is still in its rest pose (right after it
 * loads), because the armor binds against the rest pose.
 */
export class FirstPersonArmor {
  private readonly material = new ArmorMaterial();
  private readonly bySet = new Map<string, SkinnedMesh>();
  private look: CharacterLook | null = null;
  private sleeve: ArmsMaterial | null = null;
  private glove: ArmsMaterial | null = null;
  private watch: Object3D | null = null;
  private watchRest = new Vector3();
  private watchUp = new Vector3(0, 1, 0);

  attach(armsRoot: Object3D, url = FP_ARMOR_URL): Promise<void> {
    armsRoot.updateMatrixWorld(true);
    // rest pose, captured now: the viewmodel poses the rig from the next frame on
    const bones = new Map<string, Bone>();
    const restWorld = new Map<string, Matrix4>();
    armsRoot.traverse((node) => {
      if ((node as Bone).isBone) {
        bones.set(node.name, node as Bone);
        restWorld.set(node.name, node.matrixWorld.clone());
      }
      const mesh = node as Mesh;
      if (mesh.isMesh) {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of materials) {
          if (!(m instanceof MeshStandardMaterial)) continue;
          if (m.name === 'mat_sleeve') this.sleeve ??= { material: m, base: m.color.clone() };
          if (m.name === 'mat_glove') this.glove ??= { material: m, base: m.color.clone() };
        }
      }
    });
    const rootWorld = armsRoot.matrixWorld.clone();
    this.watch = armsRoot.getObjectByName('watch') ?? null;
    if (this.watch) {
      this.watchRest.copy(this.watch.position);
      // the dial normal is the watch's local +y; lift along it in the parent's space
      this.watchUp.set(0, 1, 0).applyQuaternion(this.watch.quaternion).normalize();
    }

    return sharedGltfLoader()
      .loadAsync(url)
      .then((gltf) => {
        gltf.scene.updateMatrixWorld(true);
        const names = [...bones.keys()];
        const index = new Map(names.map((name, i) => [name, i]));
        const parts = new Map<string, PartMesh[]>();
        gltf.scene.traverse((node) => {
          const extras = node.userData as Record<string, unknown>;
          if (!(node as SkinnedMesh).isSkinnedMesh || extras.slot !== 'fp') return;
          const part = extractPart(node as SkinnedMesh, extras, index);
          if (!part) return;
          parts.set(part.set, [...(parts.get(part.set) ?? []), part]);
        });
        const skeletonBones = names.map((name) => bones.get(name)!);
        const inverses = names.map((name) => restWorld.get(name)!.clone().invert());
        for (const [set, list] of parts) {
          const mesh = new SkinnedMesh(mergeParts(list), this.material);
          mesh.name = `FirstPersonArmor:${set}`;
          mesh.frustumCulled = false;
          mesh.visible = false;
          armsRoot.add(mesh);
          mesh.bind(new Skeleton(skeletonBones, inverses), rootWorld);
          this.bySet.set(set, mesh);
        }
        if (this.look) this.setLook(this.look);
      })
      .catch((error: unknown) => {
        // eslint-disable-next-line no-console
        console.warn('[Characters] first-person armor failed to load:', error);
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
    // the baked glove keeps its own charcoal and grey pads; tinting it washes the pads out
    if (this.watch) {
      this.watch.visible = look.watch;
      this.watch.position.copy(this.watchRest).addScaledVector(this.watchUp, WATCH_LIFT_M[look.arms] ?? 0);
    }
  }

  /** the arms' own materials back to how they loaded (tests, disposal) */
  reset(): void {
    if (this.sleeve) this.sleeve.material.color.copy(this.sleeve.base);
    if (this.glove) this.glove.material.color.copy(this.glove.base);
    for (const mesh of this.bySet.values()) mesh.visible = false;
    if (this.watch) {
      this.watch.visible = true;
      this.watch.position.copy(this.watchRest);
    }
  }
}
