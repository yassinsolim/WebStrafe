import { Group, Mesh, Vector3, type Object3D } from 'three';
import { sharedGltfLoader } from '../assets/gltfLoader';
import { getKnife, type KnifeId } from '../combat/knives';
import { buildProceduralKnife, KNIFE_NODES } from '../cosmetics/ProceduralKnife';
import { applyKnifeFinish } from '../cosmetics/finishes/applyFinish';
import type { KnifeCosmetic } from '../network/cosmetics';
import { attachKnifeModel } from './playerRig';

/** knife remote players hold when they haven't picked one */
export const DEFAULT_REMOTE_KNIFE: KnifeId = 'bayonet';
const CACHE_LIMIT = 12;
const templates = new Map<string, Group>();

export function remoteKnifeKey(cosmetic: KnifeCosmetic | undefined): string {
  if (!cosmetic) return `${DEFAULT_REMOTE_KNIFE}|vanilla`;
  const wear = cosmetic.wear === undefined ? '' : cosmetic.wear.toFixed(2);
  return `${cosmetic.id}|${cosmetic.finish ?? 'vanilla'}|${wear}|${cosmetic.seed ?? ''}`;
}

/**
 * a hand-ready knife template for a player's pick: grip socket at the origin,
 * blade along the hand bone's pointing axis (the same hold attachKnifeModel expects).
 * templates are cached per pick; attachKnifeModel clones them.
 */
export function remoteKnifeTemplate(cosmetic: KnifeCosmetic | undefined): Group {
  const key = remoteKnifeKey(cosmetic);
  const cached = templates.get(key);
  if (cached) return cached;
  const knife = buildProceduralKnife(getKnife(cosmetic?.id ?? DEFAULT_REMOTE_KNIFE));
  knife.updateMatrixWorld(true);
  const grip = knife.getObjectByName(KNIFE_NODES.grip);
  if (grip) knife.position.sub(grip.getWorldPosition(new Vector3()));
  if (cosmetic?.finish && cosmetic.finish !== 'vanilla') {
    applyKnifeFinish(knife, { finishId: cosmetic.finish, wear: cosmetic.wear ?? 0.05, seed: cosmetic.seed ?? 0 });
  }
  const wrapper = new Group();
  wrapper.name = 'RemoteKnifeTemplate';
  wrapper.rotation.set(0, 0, Math.PI / 2);
  wrapper.add(knife);
  wrapper.traverse((child) => {
    child.frustumCulled = false;
    if (child instanceof Mesh) {
      child.castShadow = false;
      child.receiveShadow = false;
    }
  });
  const holder = new Group();
  holder.add(wrapper);
  if (templates.size >= CACHE_LIMIT) {
    const oldest = templates.keys().next().value;
    if (oldest !== undefined) templates.delete(oldest);
  }
  templates.set(key, holder);
  return holder;
}

/** swaps the knife on a remote player's weapon hand for their current pick */
export function setRemoteKnife(handBone: Object3D, cosmetic: KnifeCosmetic | undefined): void {
  const old = handBone.getObjectByName('RemoteKnifeModel');
  old?.removeFromParent();
  attachKnifeModel(handBone as Parameters<typeof attachKnifeModel>[0], remoteKnifeTemplate(cosmetic));
}

const KATANA_URL = '/viewmodels/v2/katana.glb';
let katanaTemplate: Group | null = null;
let katanaLoading = false;

/** the viewmodel katana (grip socket at its origin, knife frame), loaded once; null until it arrives */
export function remoteKatanaTemplate(): Group | null {
  if (!katanaTemplate && !katanaLoading) {
    katanaLoading = true;
    sharedGltfLoader().loadAsync(KATANA_URL).then((gltf) => {
      const wrapper = new Group();
      wrapper.name = 'RemoteKatanaTemplate';
      // same hold as the knives: knife +x along the hand bone's pointing axis
      wrapper.rotation.set(0, 0, Math.PI / 2);
      wrapper.add(gltf.scene);
      wrapper.traverse((child) => {
        child.frustumCulled = false;
        if (child instanceof Mesh) {
          child.castShadow = false;
          child.receiveShadow = false;
        }
      });
      const holder = new Group();
      holder.add(wrapper);
      katanaTemplate = holder;
    }).catch(() => {
      katanaLoading = false;
    });
  }
  return katanaTemplate;
}

/** puts the katana in a remote player's weapon hand; false while it is still loading */
export function setRemoteKatana(handBone: Object3D): boolean {
  const template = remoteKatanaTemplate();
  if (!template) return false;
  handBone.getObjectByName('RemoteKnifeModel')?.removeFromParent();
  attachKnifeModel(handBone as Parameters<typeof attachKnifeModel>[0], template);
  return true;
}
