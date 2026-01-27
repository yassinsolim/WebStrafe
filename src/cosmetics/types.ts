export interface CosmeticTextureSet {
  baseColor: string;
  normal?: string;
  roughnessMetal?: string;
  ao?: string;
  wearMask?: string;
  detail?: string;
}

export interface CosmeticVariant {
  id: string;
  name: string;
  thumbnail?: string;
  rarity?: string;
  textures?: CosmeticTextureSet;
  wear?: number;
  patternSeed?: number;
  patternScale?: number;
  hueShift?: number;
}

export interface AnimationTimeRange {
  startSec: number;
  endSec: number;
}

export interface KnifeAnimationBehavior {
  attackRangeSelection?: 'cycle' | 'random';
  sourceClip?: string;
  equipRange?: AnimationTimeRange;
  idleLoopRange?: AnimationTimeRange;
  mouse1Ranges?: AnimationTimeRange[];
  mouse2Ranges?: AnimationTimeRange[];
}

export interface CosmeticModelEntry {
  id: string;
  name: string;
  author: string;
  license: string;
  source: string;
  modelPath: string;
  variants: CosmeticVariant[];
  animationClips?: string[];
  defaultIdleClip?: string;
  defaultAttackClip?: string;
  includesHands?: boolean;
  animationBehavior?: KnifeAnimationBehavior;
}

export interface CosmeticsManifest {
  gloves: CosmeticModelEntry[];
  knives: CosmeticModelEntry[];
}

export interface LoadoutSelection {
  gloveId: string;
  gloveVariantId: string;
  knifeId: string;
  knifeVariantId: string;
}
