import { BufferAttribute, type Bone, type Mesh, MeshStandardMaterial, type Object3D, Skeleton, type SkinnedMesh, type Texture } from 'three';
import { sharedGltfLoader } from '../assets/gltfLoader';
import { ArmorMaterial } from './armorMaterial';
import type { SkinId } from './catalog';
import { loadCharacterLibrary } from './CharacterFactory';
import { MATERIAL_SLOTS, type MaterialSlot } from './library';
import { defaultLook, type CharacterLook } from './look';
import { SkinMaterial } from './skinMaterial';
import { SKIN_URL, type SkinAsset } from './skins';
import type { PlayerModel } from '../network/types';

/** primitives of arms.glb are named fp_<set>_<slot>, set = core or an armor set id */
const PART = /^fp_([a-z]+)_([a-z]+)$/;

// the skins' art is glossy (median roughness 0.2), which up close reads as latex
const GLOVE_MATTE = 0.6;

interface ArmsPart {
  mesh: Mesh;
  set: string;
}

/**
 * paints the first-person arms: a slim cyborg, synthetic muscle under thin
 * plates (tools/blender/arms). arms.glb carries a plate kit per armor set,
 * all on the same rig; the player's arms piece picks the kit, the plates take
 * the primary paint and finish, the muscle leans towards the secondary and the
 * glow lines light up in the accent. one ArmorMaterial for every part, so the
 * finishes and edge wear match what other players see on the third-person
 * armor.
 *
 * a whole-body skin brings its own arms instead (<skin>_arms.glb, cut from
 * the skin and posed onto the same rig by tools/blender/characters/build_skins.py),
 * loaded the first time a look wears it and bound to the rig's bones by name,
 * painted with the skin's atlas like the third-person body.
 */
export class FirstPersonArmor {
  private readonly material = new ArmorMaterial();
  private readonly parts: ArmsPart[] = [];
  private look: CharacterLook = defaultLook();
  private team: PlayerModel = 'terrorist';
  private watch: Object3D | null = null;
  private armsRoot: Object3D | null = null;
  private readonly skinMaterial = new SkinMaterial();
  private skinMaterialFor: SkinId | null = null;
  private readonly skinArms = new Map<SkinId, { asset: SkinAsset; meshes: SkinnedMesh[] }>();
  private readonly skinLoads = new Map<SkinId, Promise<void>>();
  /** settles once the arms of the latest skin asked for are in (tests, tooling) */
  public ready: Promise<void> = Promise.resolve();

  attach(armsRoot: Object3D): void {
    let atlas: { normal: Texture; orm: Texture } | null = null;
    armsRoot.traverse((node) => {
      const mesh = node as Mesh;
      if (!mesh.isMesh || Array.isArray(mesh.material)) return;
      const source = mesh.material;
      const match = PART.exec(source.name);
      if (!match) return;
      const slot = MATERIAL_SLOTS.indexOf(match[2] as MaterialSlot);
      if (slot < 0) return;
      if (!atlas && source instanceof MeshStandardMaterial && source.normalMap && source.aoMap) {
        atlas = { normal: source.normalMap, orm: source.aoMap };
      }
      const geometry = mesh.geometry;
      const count = geometry.getAttribute('position').count;
      geometry.setAttribute('aSlot', new BufferAttribute(new Float32Array(count).fill(slot), 1));
      // ao and edge wear live in the atlas, the per-vertex pair stays neutral
      const occlusion = new Float32Array(count * 2);
      for (let i = 0; i < count; i += 1) occlusion[i * 2] = 1;
      geometry.setAttribute('aOcclusion', new BufferAttribute(occlusion, 2));
      mesh.material = this.material;
      this.parts.push({ mesh, set: match[1] });
    });
    this.material.setAtlas(atlas);
    this.watch = armsRoot.getObjectByName('watch') ?? null;
    this.armsRoot = armsRoot;
    this.setLook(this.look, this.team);
  }

  setLook(look: CharacterLook, team: PlayerModel = this.team): void {
    this.look = look;
    this.team = team;
    this.material.applyLook(look, team);
    if (look.skin !== 'kit' && this.armsRoot) this.loadSkinArms(look.skin);
    this.sync();
  }

  /** the kit, or the skin's own arms once they are in */
  private sync(): void {
    const look = this.look;
    const skin = look.skin === 'kit' ? null : this.skinArms.get(look.skin) ?? null;
    for (const part of this.parts) part.mesh.visible = !skin && (part.set === 'core' || part.set === look.arms);
    for (const [id, arms] of this.skinArms) {
      for (const mesh of arms.meshes) mesh.visible = skin !== null && id === look.skin;
    }
    // the watch is sized for the kit's slim wrist, armored skins would swallow it
    if (this.watch) this.watch.visible = look.watch && !skin;
    if (skin) {
      if (this.skinMaterialFor !== skin.asset.id) {
        this.skinMaterialFor = skin.asset.id;
        this.skinMaterial.setSkin(skin.asset);
        this.skinMaterial.setMatte(GLOVE_MATTE);
      }
      this.skinMaterial.applyLook(look, this.team);
    }
  }

  private loadSkinArms(id: SkinId): void {
    if (this.skinLoads.has(id)) return;
    const load = Promise.all([loadCharacterLibrary(), sharedGltfLoader().loadAsync(`${SKIN_URL}/${id}_arms.glb`)])
      .then(([library, gltf]) => {
        const asset = library?.skins.get(id);
        if (!asset) return;
        const meshes = this.adopt(gltf.scene);
        if (meshes.length === 0) return;
        this.skinArms.set(id, { asset, meshes });
        this.sync();
      })
      .catch((error: unknown) => {
        // eslint-disable-next-line no-console
        console.warn(`[Characters] first-person arms for ${id} failed to load, keeping the kit:`, error);
      });
    this.skinLoads.set(id, load);
    this.ready = load;
  }

  /**
   * moves a skin's arm meshes onto the arms rig. both files share the rig's
   * rest pose, so the meshes keep their own inverse bind matrices and only
   * swap their bones for the rig's, matched by name
   */
  private adopt(scene: Object3D): SkinnedMesh[] {
    const root = this.armsRoot;
    if (!root) return [];
    let host: Object3D = root;
    root.traverse((node) => {
      if ((node as SkinnedMesh).isSkinnedMesh && host === root && node.parent) host = node.parent;
    });
    const found: SkinnedMesh[] = [];
    scene.traverse((node) => {
      if ((node as SkinnedMesh).isSkinnedMesh) found.push(node as SkinnedMesh);
    });
    const out: SkinnedMesh[] = [];
    for (const mesh of found) {
      const bones = mesh.skeleton.bones.map((bone) => root.getObjectByName(bone.name) as Bone | undefined);
      if (bones.some((bone) => !bone)) continue;
      const bindMatrix = mesh.bindMatrix.clone();
      host.add(mesh);
      mesh.bind(new Skeleton(bones as Bone[], mesh.skeleton.boneInverses), bindMatrix);
      mesh.frustumCulled = false;
      mesh.material = this.skinMaterial;
      mesh.visible = false;
      out.push(mesh);
    }
    return out;
  }

  /** the skin whose arms are showing, null for the kit (tests, tooling) */
  shownSkin(): SkinId | null {
    const id = this.look.skin;
    return id !== 'kit' && this.skinArms.has(id) ? id : null;
  }

  /** the arms parts showing now (tests, tooling) */
  visibleSets(): string[] {
    return [...new Set(this.parts.filter((p) => p.mesh.visible).map((p) => p.set))].sort();
  }

  /** every kit the arms file carries */
  sets(): string[] {
    return [...new Set(this.parts.map((p) => p.set))].sort();
  }

  get armorMaterial(): ArmorMaterial {
    return this.material;
  }
}
