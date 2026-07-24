import {
  AnimationClip,
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
} from 'three';
import { describe, expect, it } from 'vitest';
import {
  WeaponViewmodels,
  type WeaponViewmodelLoader,
} from '../WeaponViewmodels';
import { ViewmodelPresentation } from '../ViewmodelPresentation';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

const loadWatch = async () => new Group();

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function asset(id: 'deagle' | 'awp'): {
  scene: Object3D;
  animations: AnimationClip[];
} {
  const scene = new Group();
  const arm = new Mesh(
    new BoxGeometry(1, 1, 1),
    new MeshStandardMaterial({ name: id === 'deagle' ? 'Gloves' : 'Material' }),
  );
  arm.name = `${id}:arms`;
  scene.add(arm);
  if (id === 'awp') {
    const leftWrist = new Group();
    leftWrist.name = 'Wrist.L';
    const rightWrist = new Group();
    rightWrist.name = 'Wrist.R';
    scene.add(leftWrist, rightWrist);
  }
  const prefix = id === 'deagle' ? 'rig|' : 'Arm|';
  return {
    scene,
    animations: [
      new AnimationClip(`${prefix}Idle`, 1, []),
      new AnimationClip(`${prefix}${id === 'deagle' ? 'Equip' : 'Draw'}`, 0.5, []),
      new AnimationClip(`${prefix}Fire`, 0.4, []),
      new AnimationClip(`${prefix}Reload`, 2, []),
    ],
  };
}

function isEffectivelyVisible(object: Object3D | null | undefined): boolean {
  if (!object) return false;
  for (let current: Object3D | null = object; current; current = current.parent) {
    if (!current.visible) return false;
  }
  return true;
}

describe('ViewmodelPresentation integration', () => {
  it('owns actual knife and firearm roots across load races and rapid switches', async () => {
    const deagleLoad = deferred<ReturnType<typeof asset>>();
    const awpLoad = deferred<ReturnType<typeof asset>>();
    const loader: WeaponViewmodelLoader = {
      loadAsync: (url) => url.includes('deagle') ? deagleLoad.promise : awpLoad.promise,
    };
    const firearms = new WeaponViewmodels(loader, loadWatch);
    const knifeRoot = new Group();
    const knifeMesh = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    knifeRoot.add(knifeMesh);
    const presentation = new ViewmodelPresentation(knifeRoot, firearms);
    const loading = firearms.load();

    presentation.setWeapon('deagle');
    presentation.setWeapon('awp');
    presentation.setWeapon('deagle');
    expect(isEffectivelyVisible(knifeMesh)).toBe(false);
    expect(presentation.getState().firearmVisible).toBe(true);

    awpLoad.resolve(asset('awp'));
    await awpLoad.promise;
    await Promise.resolve();
    expect(firearms.root.getObjectByName('gun:awp')?.visible).toBe(false);

    deagleLoad.resolve(asset('deagle'));
    await loading;
    expect(isEffectivelyVisible(firearms.root.getObjectByName('deagle:arms'))).toBe(true);
    expect(isEffectivelyVisible(knifeMesh)).toBe(false);

    presentation.setWeapon('knife');
    expect(isEffectivelyVisible(knifeMesh)).toBe(true);
    expect(isEffectivelyVisible(firearms.root.getObjectByName('deagle:arms')!)).toBe(false);
    expect(firearms.getPresentationState().active).toBeNull();

    for (const weaponId of ['deagle', 'awp', 'knife', 'awp', 'knife'] as const) {
      presentation.setWeapon(weaponId);
      const visible = [
        isEffectivelyVisible(knifeMesh),
        isEffectivelyVisible(firearms.root.getObjectByName('deagle:arms')!),
        isEffectivelyVisible(firearms.root.getObjectByName('awp:arms')!),
      ];
      expect(visible.filter(Boolean)).toHaveLength(1);
      expect(visible).toEqual([
        weaponId === 'knife',
        weaponId === 'deagle',
        weaponId === 'awp',
      ]);
    }
  });

  it('hides all models on death and restores only the selected weapon on respawn', async () => {
    const loader: WeaponViewmodelLoader = {
      loadAsync: async (url) => asset(url.includes('deagle') ? 'deagle' : 'awp'),
    };
    const firearms = new WeaponViewmodels(loader, loadWatch);
    const knifeRoot = new Group();
    const knifeMesh = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    knifeRoot.add(knifeMesh);
    const presentation = new ViewmodelPresentation(knifeRoot, firearms);
    await firearms.load();

    presentation.setWeapon('deagle');
    presentation.setAlive(false);
    presentation.setWeapon('awp');
    expect(isEffectivelyVisible(knifeMesh)).toBe(false);
    expect(isEffectivelyVisible(firearms.root.getObjectByName('deagle:arms')!)).toBe(false);
    expect(isEffectivelyVisible(firearms.root.getObjectByName('awp:arms')!)).toBe(false);

    presentation.setAlive(true);
    expect(isEffectivelyVisible(knifeMesh)).toBe(false);
    expect(isEffectivelyVisible(firearms.root.getObjectByName('deagle:arms')!)).toBe(false);
    expect(isEffectivelyVisible(firearms.root.getObjectByName('awp:arms'))).toBe(true);
  });
});
