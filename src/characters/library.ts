import {
  BufferAttribute,
  BufferGeometry,
  Matrix3,
  Matrix4,
  NoColorSpace,
  Object3D,
  Quaternion,
  SkinnedMesh,
  type Texture,
  TextureLoader,
  Vector3,
  Vector4,
} from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { sharedGltfLoader } from '../assets/gltfLoader';
import type { SkinId } from './catalog';
import { ALL_JOINTS } from './skeleton';
import type { SkinAsset } from './skins';

export const ARMOR_URL = '/characters/armor.glb';

/** material slots, the order is the shader's slot index */
export const MATERIAL_SLOTS = [
  'primary',
  'secondary',
  'accent',
  'suit',
  'dark',
  'light',
  'visor',
  'metal',
  'cloth',
  'trim',
  // first-person cyborg arms: synthetic muscle and glow lines
  'muscle',
  'glow',
] as const;
export type MaterialSlot = (typeof MATERIAL_SLOTS)[number];

export const LOD_LEVELS = 3;

/** one mesh from the library, already in model space with runtime bone indices */
export interface PartMesh {
  slot: string;
  set: string;
  part: string;
  lod: number;
  material: MaterialSlot;
  position: Float32Array;
  normal: Float32Array;
  /** ao and edge wear per vertex */
  occlusion: Float32Array;
  /** texture atlas coordinates (zeros for parts built without one) */
  uv: Float32Array;
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
  index: Uint32Array;
}

export interface DecalAnchor {
  set: string;
  kind: 'emblem' | 'tag';
  bone: string;
  /** bind pose, model space; +z out of the surface, +y up the decal */
  position: Vector3;
  quaternion: Quaternion;
  size: number;
}

const JOINT_INDEX = new Map(ALL_JOINTS.map((j, i) => [j.name, i]));

const tmpV = new Vector3();
const tmpN = new Vector3();
const tmpSkin = new Vector4();

/**
 * the armor part library (public/characters/armor.glb, built by
 * tools/blender/characters). holds every piece per slot, set and lod as plain
 * arrays so characters can merge the ones they wear into one skinned mesh.
 */
export class CharacterLibrary {
  private readonly parts = new Map<string, PartMesh[]>();
  public readonly anchors: DecalAnchor[] = [];
  private readonly mergedCache = new Map<string, BufferGeometry>();
  /** baked atlas every part's uvs point into: tangent normals, and ao / roughness detail / edge wear */
  public atlas: { normal: Texture; orm: Texture } | null = null;
  /** whole-body skins that loaded (skins.ts); a look whose skin is missing wears the kit */
  public skins = new Map<SkinId, SkinAsset>();

  static async load(url = ARMOR_URL): Promise<CharacterLibrary> {
    const [gltf, atlas] = await Promise.all([sharedGltfLoader().loadAsync(url), loadAtlas(url)]);
    const lib = CharacterLibrary.fromGltf(gltf);
    lib.atlas = atlas;
    return lib;
  }

  static fromGltf(gltf: Pick<GLTF, 'scene'>): CharacterLibrary {
    const lib = new CharacterLibrary();
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((node: Object3D) => {
      const extras = node.userData as Record<string, unknown>;
      if ((node as SkinnedMesh).isSkinnedMesh && typeof extras.slot === 'string') {
        lib.addPart(node as SkinnedMesh, extras);
      } else if (typeof extras.kind === 'string' && typeof extras.bone === 'string' && typeof extras.set === 'string') {
        // decal spots are empties; gltf loading strips the dots from their names, so go by extras
        lib.anchors.push({
          set: String(extras.set),
          kind: extras.kind === 'tag' ? 'tag' : 'emblem',
          bone: extras.bone,
          position: node.getWorldPosition(new Vector3()),
          quaternion: node.getWorldQuaternion(new Quaternion()),
          size: typeof extras.size === 'number' ? extras.size : 0.06,
        });
      }
    });
    return lib;
  }

  /** every mesh a slot/set brings at a level of detail (empty if the library lacks it) */
  get(slot: string, set: string, lod: number): PartMesh[] {
    return this.parts.get(`${slot}.${set}.${lod}`) ?? [];
  }

  has(slot: string, set: string): boolean {
    return this.parts.has(`${slot}.${set}.0`);
  }

  /** memoized geometry for a combination of pieces at a lod */
  merged(key: string, build: () => BufferGeometry): BufferGeometry {
    let geometry = this.mergedCache.get(key);
    if (!geometry) {
      geometry = build();
      this.mergedCache.set(key, geometry);
    }
    return geometry;
  }

  stats(): { parts: number; lod0Triangles: number } {
    let parts = 0;
    let lod0Triangles = 0;
    for (const [key, list] of this.parts) {
      parts += list.length;
      if (key.endsWith('.0')) lod0Triangles += list.reduce((sum, p) => sum + p.index.length / 3, 0);
    }
    return { parts, lod0Triangles };
  }

  private addPart(mesh: SkinnedMesh, extras: Record<string, unknown>): void {
    const part = extractPart(mesh, extras, JOINT_INDEX);
    if (!part) return;
    const key = `${part.slot}.${part.set}.${part.lod}`;
    const list = this.parts.get(key) ?? [];
    list.push(part);
    this.parts.set(key, list);
  }
}

/**
 * reads one skinned part into plain model-space arrays with its joints mapped
 * onto `jointIndex` (bone name -> index in the target skeleton)
 */
export function extractPart(mesh: SkinnedMesh, extras: Record<string, unknown>, jointIndex: Map<string, number>): PartMesh | null {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const color = geometry.getAttribute('color');
  const uvAttr = geometry.getAttribute('uv');
  const skinIndex = geometry.getAttribute('skinIndex');
  const skinWeight = geometry.getAttribute('skinWeight');
  if (!position || !normal || !skinIndex || !skinWeight) return null;
  const material = String(extras.mat ?? 'primary') as MaterialSlot;
  if (!MATERIAL_SLOTS.includes(material)) return null;

  // quantized meshes carry their dequantization in the bind matrices; in the
  // rest pose every bone gives the same model-space transform
  const skeleton = mesh.skeleton;
  const toModel = new Matrix4()
    .copy(mesh.matrixWorld)
    .multiply(mesh.bindMatrixInverse)
    .multiply(skeleton.bones[0].matrixWorld)
    .multiply(skeleton.boneInverses[0])
    .multiply(mesh.bindMatrix);
  const normalMatrix = new Matrix3().getNormalMatrix(toModel);
  const remap = skeleton.bones.map((bone) => jointIndex.get(bone.name) ?? 0);

  const count = position.count;
  const pos = new Float32Array(count * 3);
  const nrm = new Float32Array(count * 3);
  const occ = new Float32Array(count * 2);
  const uv = new Float32Array(count * 2);
  const sIdx = new Uint16Array(count * 4);
  const sW = new Float32Array(count * 4);
  for (let i = 0; i < count; i += 1) {
    tmpV.fromBufferAttribute(position, i).applyMatrix4(toModel);
    pos[i * 3] = tmpV.x;
    pos[i * 3 + 1] = tmpV.y;
    pos[i * 3 + 2] = tmpV.z;
    tmpN.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize();
    nrm[i * 3] = tmpN.x;
    nrm[i * 3 + 1] = tmpN.y;
    nrm[i * 3 + 2] = tmpN.z;
    occ[i * 2] = color ? color.getX(i) : 1;
    occ[i * 2 + 1] = color ? color.getY(i) : 0;
    if (uvAttr) {
      uv[i * 2] = uvAttr.getX(i);
      uv[i * 2 + 1] = uvAttr.getY(i);
    }
    tmpSkin.set(skinIndex.getX(i), skinIndex.getY(i), skinIndex.getZ(i), skinIndex.getW(i));
    sIdx[i * 4] = remap[tmpSkin.x] ?? 0;
    sIdx[i * 4 + 1] = remap[tmpSkin.y] ?? 0;
    sIdx[i * 4 + 2] = remap[tmpSkin.z] ?? 0;
    sIdx[i * 4 + 3] = remap[tmpSkin.w] ?? 0;
    tmpSkin.set(skinWeight.getX(i), skinWeight.getY(i), skinWeight.getZ(i), skinWeight.getW(i));
    const total = tmpSkin.x + tmpSkin.y + tmpSkin.z + tmpSkin.w || 1;
    sW[i * 4] = tmpSkin.x / total;
    sW[i * 4 + 1] = tmpSkin.y / total;
    sW[i * 4 + 2] = tmpSkin.z / total;
    sW[i * 4 + 3] = tmpSkin.w / total;
  }
  const index = geometry.index
    ? Uint32Array.from(geometry.index.array as ArrayLike<number>)
    : Uint32Array.from({ length: count }, (_, i) => i);

const part: PartMesh = {
    slot: String(extras.slot),
    set: String(extras.set),
    part: String(extras.part ?? mesh.name),
    lod: Number(extras.lod ?? 0),
    material,
    position: pos,
    normal: nrm,
    occlusion: occ,
    uv,
    skinIndex: sIdx,
    skinWeight: sW,
    index,
  };
  return part;
}

/** concatenates part meshes into one skinned geometry with a per-vertex material slot */
export function mergeParts(parts: PartMesh[]): BufferGeometry {
  let vertices = 0;
  let indices = 0;
  for (const p of parts) {
    vertices += p.position.length / 3;
    indices += p.index.length;
  }
  const position = new Float32Array(vertices * 3);
  const normal = new Float32Array(vertices * 3);
  const occlusion = new Float32Array(vertices * 2);
  const uv = new Float32Array(vertices * 2);
  const slot = new Float32Array(vertices);
  const skinIndex = new Uint16Array(vertices * 4);
  const skinWeight = new Float32Array(vertices * 4);
  const index = vertices > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
  let v = 0;
  let k = 0;
  for (const p of parts) {
    const n = p.position.length / 3;
    position.set(p.position, v * 3);
    normal.set(p.normal, v * 3);
    occlusion.set(p.occlusion, v * 2);
    if (p.uv) uv.set(p.uv, v * 2);
    slot.fill(MATERIAL_SLOTS.indexOf(p.material), v, v + n);
    skinIndex.set(p.skinIndex, v * 4);
    skinWeight.set(p.skinWeight, v * 4);
    for (let i = 0; i < p.index.length; i += 1) index[k + i] = p.index[i] + v;
    v += n;
    k += p.index.length;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('normal', new BufferAttribute(normal, 3));
  geometry.setAttribute('aOcclusion', new BufferAttribute(occlusion, 2));
  geometry.setAttribute('uv', new BufferAttribute(uv, 2));
  geometry.setAttribute('aSlot', new BufferAttribute(slot, 1));
  geometry.setAttribute('skinIndex', new BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new BufferAttribute(skinWeight, 4));
  geometry.setIndex(new BufferAttribute(index, 1));
  return geometry;
}

/** the atlas pngs next to the glb, as webp (null when the library was built without one) */
async function loadAtlas(glbUrl: string): Promise<{ normal: Texture; orm: Texture } | null> {
  const base = glbUrl.replace(/\.glb(\?.*)?$/, '');
  const loader = new TextureLoader();
  const load = (suffix: string) =>
    loader.loadAsync(`${base}_${suffix}.webp`).then((tex) => {
      // gltf uv convention, linear data
      tex.flipY = false;
      tex.colorSpace = NoColorSpace;
      tex.anisotropy = 4;
      tex.needsUpdate = true;
      return tex;
    });
  try {
    const [normal, orm] = await Promise.all([load('normal'), load('orm')]);
    return { normal, orm };
  } catch {
    return null;
  }
}
