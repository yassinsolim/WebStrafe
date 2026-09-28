import { KNIVES, type KnifeId } from '../combat/knives';
import type { GripCheck } from './gripCheck';
import type { ViewAction, ViewmodelSystem } from './ViewmodelSystem';

/** frames checked for every knife: idle plus key moments of each clip */
export const GRIP_CHECK_FRAMES: ReadonlyArray<readonly [ViewAction, number]> = [
  ['idle', 0],
  ['draw', 0.15], ['draw', 0.4], ['draw', 0.7], ['draw', 1.2],
  ['slashA', 0.07], ['slashA', 0.19], ['slashB', 0.19],
  ['stab', 0.2], ['stab', 0.36], ['backstab', 0.25],
  ['inspect', 0.6], ['inspect', 1.0], ['inspect', 1.6], ['inspect', 2.2], ['inspect', 2.9],
];

export interface GripFrameReport {
  knife: KnifeId;
  action: ViewAction;
  t: number;
  /** 0 when the hand is closed on the knife, up to 1 while the fingers let go (spins, tosses) */
  gripOpen: number;
  /** 0..1 while a hammer-grip knife hangs on the index finger (skeleton spins) */
  ringHold: number;
  kind: string;
  source: string;
  check: GripCheck;
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
export async function runGripCheck(vm: ViewmodelSystem): Promise<GripFrameReport[]> {
  const out: GripFrameReport[] = [];
  vm.equip('knife');
  vm.setPaused(true);
  for (const def of KNIVES) {
    vm.setKnife(def.id);
    await waitForModel(vm);
    for (const [action, t] of GRIP_CHECK_FRAMES) {
      vm.seek(action, t);
      const debug = vm.debugGrip();
      const check = vm.checkKnifeGrip();
      if (!debug || !check) continue;
      out.push({
        knife: def.id,
        action,
        t,
        gripOpen: vm.debugChannel('gripOpen'),
        ringHold: vm.debugChannel('ringHold'),
        kind: String(debug.kind),
        source: String(debug.source),
        check,
      });
    }
  }
  return out;
}
