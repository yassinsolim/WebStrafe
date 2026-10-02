import { KNIVES, type KnifeId } from '../combat/knives';
import type { GripCheck } from './gripCheck';
import { knifeInspectCount } from './knifeClips';
import type { ViewAction, ViewmodelSystem } from './ViewmodelSystem';

/** frames checked for every knife: idle plus key moments of each clip */
export const GRIP_CHECK_FRAMES: ReadonlyArray<readonly [ViewAction, number]> = [
  ['idle', 0],
  ['draw', 0.15], ['draw', 0.4], ['draw', 0.7], ['draw', 1.2],
  ['slashA', 0.07], ['slashA', 0.19], ['slashB', 0.19],
  ['stab', 0.2], ['stab', 0.36], ['backstab', 0.25],
  ['inspect', 0.6], ['inspect', 1.0], ['inspect', 1.6], ['inspect', 2.2], ['inspect', 2.9],
];

/** clips swept end to end when a step is given */
const SWEPT: readonly ViewAction[] = ['draw', 'slashA', 'slashB', 'stab', 'backstab', 'inspect'];

function framesFor(vm: ViewmodelSystem, step: number): ReadonlyArray<readonly [ViewAction, number]> {
  if (step <= 0) return GRIP_CHECK_FRAMES;
  const frames: Array<readonly [ViewAction, number]> = [['idle', 0]];
  for (const action of SWEPT) {
    const duration = vm.knifeActionDuration(action);
    for (let t = 0; t <= duration + 1e-6; t += step) frames.push([action, Math.round(t * 1000) / 1000]);
  }
  return frames;
}

/** the rare inspect swept end to end (call with the rare variant selected) */
function rareFrames(vm: ViewmodelSystem, step: number): ReadonlyArray<readonly [ViewAction, number]> {
  vm.setInspectVariant(1);
  const duration = vm.knifeActionDuration('inspect');
  const frames: Array<readonly [ViewAction, number]> = [];
  for (let t = 0; t <= duration + 1e-6; t += step) frames.push(['inspect', Math.round(t * 1000) / 1000]);
  return frames;
}

export interface GripFrameReport {
  knife: KnifeId;
  /** which hand, the push daggers check both */
  side: 'r' | 'l';
  action: ViewAction;
  /** 1 for the knife's rare inspect */
  variant: number;
  t: number;
  /** 0 when the hand is closed on the knife, up to 1 while the fingers let go (spins, tosses) */
  gripOpen: number;
  /** 0..1 while a hammer-grip knife hangs on the index finger (skeleton spins) */
  ringHold: number;
  kind: string;
  source: string;
  check: GripCheck;
  /** metres from the knife's grip socket to where the hand holds it (and to the ring hold, skeleton) */
  attach: { grip: number; ring: number | null } | null;
  /** the toss inspect's height above the hand, > 0 while the knife is meant to be in the air */
  tossY: number;
}

async function waitForModel(vm: ViewmodelSystem): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    if (vm.getKnifeObjects()[0]?.userData.source === 'glb') return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

/**
 * poses every knife through GRIP_CHECK_FRAMES in the running engine and
 * measures the live finger bones against the live knife meshes.
 */
export async function runGripCheck(vm: ViewmodelSystem, step = 0): Promise<GripFrameReport[]> {
  const out: GripFrameReport[] = [];
  vm.equip('knife');
  vm.setPaused(true);
  for (const def of KNIVES) {
    vm.setKnife(def.id);
    await waitForModel(vm);
    const sides = def.shape.pair ? (['r', 'l'] as const) : (['r'] as const);
    const usual = framesFor(vm, step);
    const passes: Array<[number, ReadonlyArray<readonly [ViewAction, number]>]> = [[0, usual]];
    if (knifeInspectCount(def) > 1) {
      passes.push([1, step > 0 ? rareFrames(vm, step) : usual.filter(([action]) => action === 'inspect')]);
    }
    for (const [variant, frames] of passes) {
      vm.setInspectVariant(variant);
      for (const [action, t] of frames) {
        vm.seek(action, t);
        const debug = vm.debugGrip();
        if (!debug) continue;
        for (const side of sides) {
          const check = vm.checkKnifeGrip(side);
          if (!check) continue;
          const attach = vm.checkKnifeAttachment(side);
          out.push({
            knife: def.id,
            side,
            action,
            variant,
            t,
            gripOpen: vm.debugGripOpen(),
            ringHold: vm.debugChannel('ringHold'),
            kind: String(debug.kind),
            source: String(debug.source),
            check,
            attach,
            tossY: vm.debugChannel('tossY'),
          });
        }
      }
    }
    vm.setInspectVariant(0);
    // let the page breathe between knives
    await new Promise((r) => setTimeout(r, 0));
  }
  return out;
}
