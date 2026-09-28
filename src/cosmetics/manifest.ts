import type { CosmeticsManifest, LoadoutSelection } from './types';

/** the loadout manifest the menu's team cards are built from */
export async function loadCosmeticsManifest(): Promise<CosmeticsManifest> {
  const response = await fetch('/cosmetics/manifest.json');
  if (!response.ok) {
    throw new Error(`Failed to load cosmetics manifest: ${response.status}`);
  }
  return (await response.json()) as CosmeticsManifest;
}

export function defaultLoadout(manifest: CosmeticsManifest): LoadoutSelection {
  const gloves = manifest.gloves[0];
  const knife = manifest.knives[0];
  return {
    gloveId: gloves.id,
    gloveVariantId: gloves.variants[0].id,
    knifeId: knife.id,
    knifeVariantId: knife.variants[0].id,
  };
}
