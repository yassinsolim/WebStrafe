import {
  AdditiveBlending,
  BufferGeometry,
  Float32BufferAttribute,
  Line,
  LineBasicMaterial,
  Scene,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';

interface ActiveTracer {
  line: Line;
  bornMs: number;
}

interface ActiveFlash {
  sprite: Sprite;
  bornMs: number;
}

const TRACER_MS = 90;
const FLASH_MS = 60;

/**
 * Lightweight shooting effects rendered into the world scene: a tracer line
 * from muzzle to impact and a muzzle-flash sprite. Effects auto-expire; call
 * {@link update} each frame with the current time.
 */
export class CombatEffects {
  private readonly tracers: ActiveTracer[] = [];
  private readonly flashes: ActiveFlash[] = [];
  private readonly tracerMaterial = new LineBasicMaterial({
    color: 0xfff2a8,
    transparent: true,
    opacity: 0.9,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  private readonly flashMaterial = new SpriteMaterial({
    color: 0xffd67a,
    transparent: true,
    opacity: 0.9,
    blending: AdditiveBlending,
    depthWrite: false,
  });

  constructor(private readonly scene: Scene) {}

  /** Spawns a tracer from `from` to `to` plus a muzzle flash at `from`. */
  spawnShot(from: Vector3, to: Vector3, nowMs: number): void {
    const geom = new BufferGeometry();
    geom.setAttribute(
      'position',
      new Float32BufferAttribute([from.x, from.y, from.z, to.x, to.y, to.z], 3),
    );
    const line = new Line(geom, this.tracerMaterial.clone());
    this.scene.add(line);
    this.tracers.push({ line, bornMs: nowMs });

    const sprite = new Sprite(this.flashMaterial.clone());
    sprite.position.copy(from);
    sprite.scale.setScalar(0.35);
    this.scene.add(sprite);
    this.flashes.push({ sprite, bornMs: nowMs });
  }

  update(nowMs: number): void {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      const age = nowMs - t.bornMs;
      if (age >= TRACER_MS) {
        this.scene.remove(t.line);
        t.line.geometry.dispose();
        (t.line.material as LineBasicMaterial).dispose();
        this.tracers.splice(i, 1);
      } else {
        (t.line.material as LineBasicMaterial).opacity = 0.9 * (1 - age / TRACER_MS);
      }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      const age = nowMs - f.bornMs;
      if (age >= FLASH_MS) {
        this.scene.remove(f.sprite);
        (f.sprite.material as SpriteMaterial).dispose();
        this.flashes.splice(i, 1);
      } else {
        (f.sprite.material as SpriteMaterial).opacity = 0.9 * (1 - age / FLASH_MS);
      }
    }
  }

  dispose(): void {
    for (const t of this.tracers) {
      this.scene.remove(t.line);
      t.line.geometry.dispose();
      (t.line.material as LineBasicMaterial).dispose();
    }
    for (const f of this.flashes) {
      this.scene.remove(f.sprite);
      (f.sprite.material as SpriteMaterial).dispose();
    }
    this.tracers.length = 0;
    this.flashes.length = 0;
    this.tracerMaterial.dispose();
    this.flashMaterial.dispose();
  }
}
