import type { Object3D } from 'three';
import type { WeaponId } from '../combat/weapons';
import type { GunId } from './WeaponViewmodels';

export interface FirearmViewmodelPresentation {
  readonly root: Object3D;
  show(id: GunId | null): void;
}

export interface ViewmodelPresentationState {
  weaponId: WeaponId;
  alive: boolean;
  knifeVisible: boolean;
  firearmVisible: boolean;
}

/**
 * The single visibility owner for first-person combat models. Keeping the knife
 * and firearms behind one state transition prevents independently loaded roots
 * from becoming visible together during rapid switching or lifecycle events.
 */
export class ViewmodelPresentation {
  private weaponId: WeaponId = 'knife';
  private alive = true;

  constructor(
    private readonly knifeRoot: Object3D,
    private readonly firearms: FirearmViewmodelPresentation,
  ) {
    this.apply();
  }

  public setWeapon(weaponId: WeaponId): void {
    if (weaponId === this.weaponId) return;
    this.weaponId = weaponId;
    this.apply();
  }

  public setAlive(alive: boolean): void {
    if (alive === this.alive) return;
    this.alive = alive;
    this.apply();
  }

  public getState(): ViewmodelPresentationState {
    return {
      weaponId: this.weaponId,
      alive: this.alive,
      knifeVisible: this.knifeRoot.visible,
      firearmVisible: this.firearms.root.visible,
    };
  }

  private apply(): void {
    const firearm =
      this.alive && (this.weaponId === 'deagle' || this.weaponId === 'awp')
        ? this.weaponId
        : null;
    const showKnife = this.alive && this.weaponId === 'knife';

    // Hide both roots first. If a GLB resolves in this transition, it can never
    // expose stale geometry before the exclusive target is selected.
    this.knifeRoot.visible = false;
    this.firearms.root.visible = false;
    this.firearms.show(null);

    if (showKnife) {
      this.knifeRoot.visible = true;
    } else if (firearm) {
      this.firearms.show(firearm);
      this.firearms.root.visible = true;
    }
  }
}
