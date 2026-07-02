import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
} from 'three';

/**
 * Procedural first-person weapon viewmodels for the Deagle and AWP. Built from
 * primitives (no external GLBs to download or license) but proportioned and
 * shaded to read clearly as a pistol and a sniper rifle in the viewmodel view.
 * GameApp toggles which one is visible based on the active weapon; the knife
 * keeps its own GLB viewmodel in CosmeticsManager.
 */
export type GunId = 'deagle' | 'awp';

const gunMetal = new MeshStandardMaterial({ color: 0x35393f, metalness: 0.7, roughness: 0.45 });
const gunMetalLight = new MeshStandardMaterial({ color: 0x484d55, metalness: 0.65, roughness: 0.5 });
const gunAccent = new MeshStandardMaterial({ color: 0x54595f, metalness: 0.5, roughness: 0.6 });
const scopeGlass = new MeshStandardMaterial({ color: 0x3a86a8, metalness: 0.3, roughness: 0.2, emissive: 0x0c2e3a });

function box(w: number, h: number, d: number, mat: MeshStandardMaterial): Mesh {
  const mesh = new Mesh(new BoxGeometry(w, h, d), mat);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  return mesh;
}

function cyl(radius: number, length: number, mat: MeshStandardMaterial, radialSegments = 16): Mesh {
  const mesh = new Mesh(new CylinderGeometry(radius, radius, length, radialSegments), mat);
  // CylinderGeometry runs along +Y; rotate so it runs along -Z (forward).
  mesh.rotation.x = Math.PI / 2;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  return mesh;
}

function buildDeagle(): Group {
  const g = new Group();
  g.name = 'vm-deagle';

  // Slide + barrel (forward along -Z).
  const slide = box(0.05, 0.06, 0.26, gunMetalLight);
  slide.position.set(0, 0, -0.09);
  g.add(slide);

  const barrelTip = box(0.045, 0.045, 0.06, gunMetal);
  barrelTip.position.set(0, 0, -0.24);
  g.add(barrelTip);

  // Frame under the slide.
  const frame = box(0.048, 0.03, 0.2, gunMetal);
  frame.position.set(0, -0.05, -0.07);
  g.add(frame);

  // Grip, raked back and down.
  const grip = box(0.05, 0.15, 0.06, gunAccent);
  grip.position.set(0, -0.13, 0.03);
  grip.rotation.x = -0.32;
  g.add(grip);

  // Trigger guard.
  const guard = box(0.04, 0.05, 0.02, gunMetal);
  guard.position.set(0, -0.075, -0.02);
  g.add(guard);

  // Rear sight nub.
  const sight = box(0.02, 0.02, 0.02, gunMetal);
  sight.position.set(0, 0.04, 0.02);
  g.add(sight);

  g.scale.setScalar(0.9);
  g.position.set(-0.02, 0.02, -0.06);
  g.rotation.y = 0.06;
  return g;
}

function buildAwp(): Group {
  const g = new Group();
  g.name = 'vm-awp';

  // Long barrel.
  const barrel = cyl(0.018, 0.5, gunMetal);
  barrel.position.set(0, 0.01, -0.3);
  g.add(barrel);

  // Muzzle.
  const muzzle = cyl(0.026, 0.06, gunMetalLight);
  muzzle.position.set(0, 0.01, -0.54);
  g.add(muzzle);

  // Receiver / body.
  const body = box(0.06, 0.09, 0.34, gunMetalLight);
  body.position.set(0, 0, -0.02);
  g.add(body);

  // Stock (behind, thumbhole-ish block).
  const stock = box(0.055, 0.12, 0.24, gunAccent);
  stock.position.set(0, -0.02, 0.22);
  g.add(stock);

  const cheek = box(0.055, 0.04, 0.14, gunMetal);
  cheek.position.set(0, 0.06, 0.2);
  g.add(cheek);

  // Grip + magazine.
  const grip = box(0.05, 0.12, 0.05, gunAccent);
  grip.position.set(0, -0.09, 0.06);
  grip.rotation.x = -0.24;
  g.add(grip);

  const mag = box(0.045, 0.09, 0.07, gunMetal);
  mag.position.set(0, -0.08, -0.05);
  g.add(mag);

  // Scope: tube on rings above the receiver.
  const scope = cyl(0.03, 0.22, gunMetalLight);
  scope.position.set(0, 0.09, -0.04);
  g.add(scope);

  const lens = cyl(0.028, 0.012, scopeGlass);
  lens.position.set(0, 0.09, -0.16);
  g.add(lens);

  for (const z of [0.03, -0.11]) {
    const ring = box(0.02, 0.05, 0.02, gunMetal);
    ring.position.set(0, 0.05, z);
    g.add(ring);
  }

  g.scale.setScalar(0.82);
  g.position.set(0.03, -0.04, 0.0);
  g.rotation.y = 0.03;
  return g;
}

export class WeaponViewmodels {
  public readonly root = new Group();
  private readonly models: Record<GunId, Object3D>;
  private recoilOffset = 0;

  constructor() {
    this.root.name = 'WeaponViewmodels';
    this.models = { deagle: buildDeagle(), awp: buildAwp() };
    for (const model of Object.values(this.models)) {
      model.visible = false;
      this.root.add(model);
    }
  }

  /** Shows the given gun (hiding the others), or hides all when null. */
  public show(id: GunId | null): void {
    for (const key of Object.keys(this.models) as GunId[]) {
      this.models[key].visible = key === id;
    }
  }

  /** Kicks the visible gun backward for a quick recoil pop. */
  public recoil(): void {
    this.recoilOffset = 0.05;
  }

  public update(dt: number): void {
    if (this.recoilOffset > 1e-4) {
      this.recoilOffset = Math.max(0, this.recoilOffset - dt * 0.4);
      this.root.position.z = this.recoilOffset;
    } else if (this.root.position.z !== 0) {
      this.root.position.z = 0;
    }
  }
}
