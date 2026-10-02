import { BufferGeometry, NoColorSpace, Quaternion, SRGBColorSpace, type SkinnedMesh, type Texture, TextureLoader, Vector3 } from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { sharedGltfLoader } from '../assets/gltfLoader';
import { SKINS, type SkinId } from './catalog';
import { extractPart, LOD_LEVELS, mergeParts, type DecalAnchor, type PartMesh } from './library';
import { ALL_JOINTS, type JointSpec } from './skeleton';

export const SKIN_URL = '/characters/skins';

export interface SkinTextures {
  /** srgb albedo */
  color: Texture;
  normal: Texture;
  /** r glow, g roughness, b metalness */
  data: Texture;
  /** r primary, g secondary, b accent paint zones */
  mask: Texture;
}

/** one whole-body skin: its meshes per lod, its own bind joints and its atlas */
export interface SkinAsset {
  id: SkinId;
  parts: PartMesh[][];
  geometries: BufferGeometry[];
  /** ALL_JOINTS with this skin's joint positions (the orientations are the game's) */
  joints: JointSpec[];
  /** where the emblem and callsign go on the chest */
  anchors: DecalAnchor[];
  textures: SkinTextures | null;
}

const JOINT_INDEX = new Map(ALL_JOINTS.map((j, i) => [j.name, i]));

/** the game skeleton moved onto a skin's joint positions (three space, model frame) */
export function skinJoints(positions: Record<string, readonly number[]>): JointSpec[] {
  const at = (name: string) => {
    const p = positions[name];
    return p && p.length === 3 ? new Vector3(p[0], p[1], p[2]) : null;
  };
  const resolved = new Map<string, Vector3>();
  return ALL_JOINTS.map((spec) => {
    const own = at(spec.name);
    const parent = spec.parent ? resolved.get(spec.parent)! : null;
    let world: Vector3;
    if (own) world = own;
    else if (!parent) world = new Vector3(...(spec.at ?? [0, 0, 0]));
    else world = parent.clone();
    resolved.set(spec.name, world);
    const offset = parent ? world.clone().sub(parent) : world;
    return { name: spec.name, parent: spec.parent, q: spec.q, at: [offset.x, offset.y, offset.z] };
  });
}

/** reads a skin glb (tools/characters/build-skins.sh) into lod meshes and joints */
export function skinFromGltf(id: SkinId, gltf: Pick<GLTF, 'scene'>): SkinAsset | null {
  const parts: PartMesh[][] = Array.from({ length: LOD_LEVELS }, () => []);
  const anchors: DecalAnchor[] = [];
  const found: { joints: JointSpec[] | null } = { joints: null };
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((node) => {
    const extras = node.userData as Record<string, unknown>;
    if (typeof extras.kind === 'string' && typeof extras.bone === 'string' && extras.set === id) {
      anchors.push({
        set: id,
        kind: extras.kind === 'tag' ? 'tag' : 'emblem',
        bone: extras.bone,
        position: node.getWorldPosition(new Vector3()),
        quaternion: node.getWorldQuaternion(new Quaternion()),
        size: typeof extras.size === 'number' ? extras.size : 0.07,
      });
      return;
    }
    if (!(node as SkinnedMesh).isSkinnedMesh || extras.slot !== 'skin') return;
    const part = extractPart(node as SkinnedMesh, extras, JOINT_INDEX);
    if (!part || part.lod < 0 || part.lod >= LOD_LEVELS) return;
    parts[part.lod].push(part);
    if (typeof extras.joints === 'string') {
      try {
        found.joints = skinJoints(JSON.parse(extras.joints) as Record<string, number[]>);
      } catch {
        found.joints = null;
      }
    }
  });
  const joints = found.joints;
  if (!joints || parts.some((list) => list.length === 0)) return null;
  return { id, parts, geometries: parts.map((list) => mergeParts(list)), joints, anchors, textures: null };
}

function loadTexture(url: string, srgb: boolean): Promise<Texture> {
  return new TextureLoader().loadAsync(url).then((tex) => {
    // gltf uv convention
    tex.flipY = false;
    tex.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return tex;
  });
}

export async function loadSkin(id: SkinId, base = SKIN_URL): Promise<SkinAsset | null> {
  const [gltf, color, normal, data, mask] = await Promise.all([
    sharedGltfLoader().loadAsync(`${base}/${id}.glb`),
    loadTexture(`${base}/${id}_color.webp`, true),
    loadTexture(`${base}/${id}_normal.webp`, false),
    loadTexture(`${base}/${id}_data.webp`, false),
    loadTexture(`${base}/${id}_mask.webp`, false),
  ]);
  const skin = skinFromGltf(id, gltf);
  if (skin) skin.textures = { color, normal, data, mask };
  return skin;
}

/** every skin that loads; one that fails is left out and its players fall back to the kit */
export async function loadSkins(): Promise<Map<SkinId, SkinAsset>> {
  const out = new Map<SkinId, SkinAsset>();
  await Promise.all(
    SKINS.map((id) =>
      loadSkin(id)
        .then((skin) => {
          if (skin) out.set(id, skin);
        })
        .catch((error: unknown) => {
          // eslint-disable-next-line no-console
          console.warn(`[Characters] skin ${id} failed to load:`, error);
        }),
    ),
  );
  return out;
}
