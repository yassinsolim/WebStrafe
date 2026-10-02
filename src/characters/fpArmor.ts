import { BufferAttribute, type Mesh, MeshStandardMaterial, type Object3D, type Texture } from 'three';
import { ArmorMaterial } from './armorMaterial';
import { MATERIAL_SLOTS, type MaterialSlot } from './library';
import { defaultLook, type CharacterLook } from './look';
import type { PlayerModel } from '../network/types';

/** primitives of arms.glb are named fp_<set>_<slot>, set = core or an armor set id */
const PART = /^fp_([a-z]+)_([a-z]+)$/;

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
 */
export class FirstPersonArmor {
  private readonly material = new ArmorMaterial();
  private readonly parts: ArmsPart[] = [];
  private look: CharacterLook = defaultLook();
  private team: PlayerModel = 'terrorist';
  private watch: Object3D | null = null;

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
    this.setLook(this.look, this.team);
  }

  setLook(look: CharacterLook, team: PlayerModel = this.team): void {
    this.look = look;
    this.team = team;
    this.material.applyLook(look, team);
    for (const part of this.parts) part.mesh.visible = part.set === 'core' || part.set === look.arms;
    if (this.watch) this.watch.visible = look.watch;
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
