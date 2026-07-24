export const GAMEPLAY_WEAPON_ORDER = ['awp', 'deagle', 'knife'] as const;

export type GameplayWeaponId = (typeof GAMEPLAY_WEAPON_ORDER)[number];
export type WeaponSlot = 1 | 2 | 3;
export type WeaponCycleDirection = -1 | 0 | 1;

interface KeyboardIdentity {
  code: string;
  key: string;
}

interface EditableEventTarget extends EventTarget {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => Element | null;
}

export function weaponSlotForKey(event: KeyboardIdentity): WeaponSlot | null {
  if (event.code === 'Digit1' || event.code === 'Numpad1') return 1;
  if (event.code === 'Digit2' || event.code === 'Numpad2') return 2;
  if (event.code === 'Digit3' || event.code === 'Numpad3') return 3;
  if (event.key === '1') return 1;
  if (event.key === '2') return 2;
  if (event.key === '3') return 3;
  return null;
}

export function weaponCycleDirection(deltaY: number): WeaponCycleDirection {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 0;
  return deltaY > 0 ? 1 : -1;
}

export function selectWeaponFromInput(
  active: GameplayWeaponId,
  slot: WeaponSlot | null,
  cycle: WeaponCycleDirection,
): GameplayWeaponId {
  if (slot !== null) return GAMEPLAY_WEAPON_ORDER[slot - 1];
  if (cycle === 0) return active;
  const activeIndex = GAMEPLAY_WEAPON_ORDER.indexOf(active);
  const nextIndex =
    (activeIndex + cycle + GAMEPLAY_WEAPON_ORDER.length) % GAMEPLAY_WEAPON_ORDER.length;
  return GAMEPLAY_WEAPON_ORDER[nextIndex];
}

export function isEditableGameplayTarget(target: EventTarget | null): boolean {
  if (!target) return false;
  const candidate = target as EditableEventTarget;
  const tagName = candidate.tagName?.toLowerCase();
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') return true;
  if (candidate.isContentEditable === true) return true;
  const editableAncestor = candidate.closest?.('[contenteditable="true"], [contenteditable=""]');
  return editableAncestor !== null && editableAncestor !== undefined;
}
