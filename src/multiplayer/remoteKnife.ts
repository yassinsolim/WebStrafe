import { Group, Mesh, Vector3, type Object3D } from 'three';
import { getKnife, type KnifeId } from '../combat/knives';
import { buildProceduralKnife, KNIFE_NODES } from '../cosmetics/ProceduralKnife';
import type { KnifeCosmetic } from '../network/cosmetics';
import { attachKnifeModel } from './playerRig';

/** knife remote players hold when they haven't picked one */
export const DEFAULT_REMOTE_KNIFE: KnifeId = 'classic';
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
  remoteFinishHook?.(knife, cosmetic);
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

type FinishHook = (knife: Object3D, cosmetic: KnifeCosmetic | undefined) => void;
let remoteFinishHook: FinishHook | null = null;

/** lets the finish system paint remote knives without this module importing it */
export function setRemoteKnifeFinishHook(hook: FinishHook | null): void {
  remoteFinishHook = hook;
  templates.clear();
}
