import {
  AnimationClip,
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Vector3,
  VectorKeyframeTrack,
} from 'three';
import { describe, expect, it } from 'vitest';
import { FIREARM_TIMINGS } from '../../combat/FirearmTiming';
import {
  WeaponViewmodels,
  type WeaponViewmodelLoader,
} from '../WeaponViewmodels';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

interface FirearmAsset {
  scene: Object3D;
  animations: AnimationClip[];
  firearm: Mesh;
  supportHand: Group;
  oldMagazine: Group;
  freshMagazine: Group;
}

const loadWatch = async () => new Group();

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function positionTrack(name: string, values: number[]): VectorKeyframeTrack {
  return new VectorKeyframeTrack(
    `${name}.position`,
    [0, 0.5, 1, 1.5, 2],
    values,
  );
}

function asset(id: 'deagle' | 'awp'): FirearmAsset {
  const scene = new Group();
  const arm = new Mesh(
    new BoxGeometry(1, 1, 1),
    new MeshStandardMaterial({ name: id === 'deagle' ? 'Gloves' : 'Material' }),
  );
  const firearm = new Mesh(
    new BoxGeometry(1, 1, 3),
    new MeshStandardMaterial({ name: id === 'deagle' ? 'MainBody' : 'Body' }),
  );
  firearm.name = `${id}:firearm`;
  const supportHand = new Group();
  supportHand.name = `${id}SupportHand`;
  const oldMagazine = new Group();
  oldMagazine.name = `${id}OldMagazine`;
  const freshMagazine = new Group();
  freshMagazine.name = `${id}FreshMagazine`;
  const leftWrist = new Group();
  leftWrist.name = 'Wrist.L';
  const rightWrist = new Group();
  rightWrist.name = 'Wrist.R';
  scene.add(
    arm,
    firearm,
    supportHand,
    oldMagazine,
    freshMagazine,
    leftWrist,
    rightWrist,
  );

  const reload = new AnimationClip(`${id}:reload`, 2, [
    positionTrack(supportHand.name, [
      0, 0, 0,
      0, 0, 0,
      -0.8, -0.2, 0,
      -0.1, 0, 0,
      0, 0, 0,
    ]),
    positionTrack(oldMagazine.name, [
      0, 0, 0,
      0, -1, 0,
      0, -1, 0,
      0, -1, 0,
      0, 0, 0,
    ]),
    positionTrack(freshMagazine.name, [
      -1, -1, 0,
      -1, -1, 0,
      -0.8, -0.2, 0,
      -0.1, 0, 0,
      -1, -1, 0,
    ]),
  ]);

  return {
    scene,
    animations: [reload],
    firearm,
    supportHand,
    oldMagazine,
    freshMagazine,
  };
}

describe('WeaponViewmodels', () => {
  it('honours the latest active selection while assets resolve out of order', async () => {
    const deagleLoad = deferred<FirearmAsset>();
    const awpLoad = deferred<FirearmAsset>();
    const loader: WeaponViewmodelLoader = {
      loadAsync: (url) => url.includes('deagle') ? deagleLoad.promise : awpLoad.promise,
    };
    const viewmodels = new WeaponViewmodels(loader, loadWatch);
    const loading = viewmodels.load();

    viewmodels.show('awp');
    viewmodels.show('deagle');
    awpLoad.resolve(asset('awp'));
    await awpLoad.promise;
    await Promise.resolve();

    expect(viewmodels.getPresentationState()).toEqual({
      active: 'deagle',
      visible: null,
      loaded: ['awp'],
      action: null,
    });

    deagleLoad.resolve(asset('deagle'));
    await loading;
    expect(viewmodels.getPresentationState()).toEqual({
      active: 'deagle',
      visible: 'deagle',
      loaded: ['deagle', 'awp'],
      action: 'equip',
    });
  });

  it('keeps only authored model geometry without synthetic limbs or magazines', async () => {
    const deagle = asset('deagle');
    const awp = asset('awp');
    const deagleMaterial = deagle.firearm.material;
    const awpMaterial = awp.firearm.material;
    const loader: WeaponViewmodelLoader = {
      loadAsync: async (url) => url.includes('deagle') ? deagle : awp,
    };
    const viewmodels = new WeaponViewmodels(loader, loadWatch);

    await Promise.all([viewmodels.load(), viewmodels.load()]);

    expect(deagle.firearm.material).toBe(deagleMaterial);
    expect(awp.firearm.material).toBe(awpMaterial);
    expect(viewmodels.root.children).toHaveLength(2);
    expect(viewmodels.root.getObjectByName('deagle:support-forearm')).toBeUndefined();
    expect(viewmodels.root.getObjectByName('deagle:reload-magazine')).toBeUndefined();
    expect(viewmodels.root.getObjectByName('awp:reload-magazine')).toBeUndefined();
  });

  it('frames the AWP at the shared firearm depth with a wider authored silhouette', async () => {
    const deagle = asset('deagle');
    const awp = asset('awp');
    const loader: WeaponViewmodelLoader = {
      loadAsync: async (url) => url.includes('deagle') ? deagle : awp,
    };
    const viewmodels = new WeaponViewmodels(loader, loadWatch);
    await viewmodels.load();
    viewmodels.show('awp');
    viewmodels.update(0.42);

    const mount = viewmodels.root.getObjectByName('gun:awp');
    const source = viewmodels.root.getObjectByName('awp:source-pivot');
    expect(mount?.position.toArray()).toEqual([0.18, -0.2, -0.88]);
    expect(source?.scale.x).toBeLessThan(1);
    expect(awp.scene.getObjectByName('Wrist.L')?.scale.toArray()).toEqual([1.22, 1.22, 1.22]);
    expect(awp.scene.getObjectByName('Wrist.R')?.scale.toArray()).toEqual([1.22, 1.22, 1.22]);
    expect(awp.scene.getObjectByName('UnifiedTacticalWatch')).toBeDefined();
  });

  it.each([
    ['deagle', [0.16, -0.28, -0.8]],
    ['awp', [0.18, -0.2, -0.88]],
  ] as const)('reveals both sides of the %s and returns to its exact idle mount', async (id, idle) => {
    const loader: WeaponViewmodelLoader = {
      loadAsync: async (url) => url.includes('deagle') ? asset('deagle') : asset('awp'),
    };
    const viewmodels = new WeaponViewmodels(loader, loadWatch);
    await viewmodels.load();
    viewmodels.show(id);
    viewmodels.update(0.42);

    const mount = viewmodels.root.getObjectByName(`gun:${id}`);
    viewmodels.setInspectPose(0.25, 1);
    expect(mount?.position.y).toBeGreaterThan(idle[1]);
    expect(mount?.position.z).toBeGreaterThan(idle[2]);
    expect(mount?.rotation.y).toBeGreaterThan(0);

    viewmodels.setInspectPose(0.75, 1);
    expect(mount?.rotation.y).toBeLessThan(0);

    viewmodels.setInspectPose(0, 0);
    expect(mount?.position.toArray()).toEqual(idle);
    expect(mount?.rotation.toArray()).toEqual([0, 0, 0, 'XYZ']);
  });

  it.each(['deagle', 'awp'] as const)(
    'samples the authored %s hand and magazine clip against combat timing',
    async (id) => {
      const deagle = asset('deagle');
      const awp = asset('awp');
      const current = id === 'deagle' ? deagle : awp;
      const loader: WeaponViewmodelLoader = {
        loadAsync: async (url) => url.includes('deagle') ? deagle : awp,
      };
      const viewmodels = new WeaponViewmodels(loader, loadWatch);
      await viewmodels.load();
      viewmodels.show(id);

      const handBase = current.supportHand.position.clone();
      const oldMagazineBase = current.oldMagazine.position.clone();
      const freshMagazineBase = current.freshMagazine.position.clone();
      const duration = FIREARM_TIMINGS[id].reloadMs / 1000;

      viewmodels.triggerReload();
      viewmodels.update(duration * 0.25);
      expect(current.oldMagazine.position.y).toBeLessThan(-0.9);
      expect(current.supportHand.position.distanceTo(handBase)).toBeLessThan(1e-9);

      viewmodels.triggerReload();
      viewmodels.update(duration * 0.6);
      expect(current.supportHand.position.distanceTo(handBase)).toBeGreaterThan(0.1);
      expect(current.freshMagazine.position.distanceTo(current.supportHand.position))
        .toBeLessThan(1e-9);
      expect(viewmodels.getPresentationState().action).toBe('reload');

      viewmodels.update(duration * 0.4);
      expect(current.supportHand.position.distanceTo(handBase)).toBeLessThan(1e-9);
      expect(current.oldMagazine.position.distanceTo(oldMagazineBase)).toBeLessThan(1e-9);
      expect(current.freshMagazine.position.distanceTo(freshMagazineBase)).toBeLessThan(1e-9);
      expect(viewmodels.getPresentationState().action).toBe('idle');
    },
  );

  it('rejects production assets that do not contain a reload clip', async () => {
    const loader: WeaponViewmodelLoader = {
      loadAsync: async () => ({ scene: new Group(), animations: [] }),
    };
    const viewmodels = new WeaponViewmodels(loader, loadWatch);

    await expect(viewmodels.load()).rejects.toThrow('has no valid reload clip');
  });

  it('restores an interrupted reload before switching back to the firearm', async () => {
    const deagle = asset('deagle');
    const awp = asset('awp');
    const loader: WeaponViewmodelLoader = {
      loadAsync: async (url) => url.includes('deagle') ? deagle : awp,
    };
    const viewmodels = new WeaponViewmodels(loader, loadWatch);
    await viewmodels.load();

    viewmodels.show('deagle');
    viewmodels.triggerReload();
    viewmodels.update(FIREARM_TIMINGS.deagle.reloadMs / 1000 * 0.6);
    expect(deagle.supportHand.position.distanceTo(new Vector3())).toBeGreaterThan(0.1);

    viewmodels.show('awp');
    viewmodels.show('deagle');
    expect(deagle.supportHand.position.distanceTo(new Vector3())).toBeLessThan(1e-9);
    expect(viewmodels.getPresentationState().action).toBe('equip');
  });
});
