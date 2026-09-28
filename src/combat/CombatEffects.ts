import {
  AdditiveBlending,
  Color,
  Group,
  Object3D,
  Scene,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
  type DataTexture,
} from 'three';
import type { FirearmId as GunId } from './FirearmTiming';
import { ImpactDecals } from './ImpactDecals';
import type { QualityPreset } from '../render/quality';
import { onEffectsLayer } from '../render/layers';
import type { SurfaceKind } from '../render/worldMaterials';
import { TracerRibbon } from './effects/TracerRibbon';
import { ParticleBurst, type BurstStyle, type Particle } from './effects/ParticleBurst';
import { createFlashTexture, createPuffTexture } from './effects/textures';

export interface ShotEffectRequest {
  weaponId: GunId;
  from: Vector3;
  to: Vector3;
  nowMs: number;
  impactNormal?: Vector3;
  /**
   * What `to` landed on: world geometry gets a bullet hole and a dust puff, a
   * server-confirmed player endpoint a blood puff (with `impactEffects` on).
   */
  impactKind?: 'world' | 'player';
  /** Remote effects receive a modest readability boost at world distance. */
  remote?: boolean;
  /** Causative kill cue persists through the delayed death presentation. */
  fatal?: boolean;
}

export interface CombatEffectsOptions {
  /** bullet holes, sparks, dust, smoke and blood; off keeps tracers, flashes and impact flashes */
  impactEffects?: boolean;
  /**
   * Real muzzle socket of the local first-person gun, in the space of the
   * viewmodel layer's world (the layer passed as `localMuzzleParent`). Null
   * falls back to the fixed camera-space anchors.
   */
  getLocalMuzzleWorldPosition?: (weapon: GunId) => Vector3 | null;
  /**
   * World point where a local tracer starts: on the line from the eye through
   * the drawn muzzle, so the streak leaves the gun on screen even though the
   * viewmodel has its own fov.
   */
  getLocalTracerOrigin?: (weapon: GunId) => Vector3 | null;
  /** what the round hit, from the render mesh at the impact */
  resolveSurface?: (point: Vector3, direction: Vector3) => SurfaceKind | null;
  /** 0 (deep shade) .. 1 (full sun) at a point, so dust in the shade doesn't glow */
  lightAt?: (point: Vector3) => number;
  /** a local shot flashed, for the viewmodel and world flash lights */
  onLocalMuzzleFlash?: (weapon: GunId) => void;
  /** random source for decal spin and particles */
  random?: () => number;
}

/** bullet hole size per weapon, metres (visual choice, .50 AE and .338 read larger than life) */
export const DECAL_SIZE_M: Readonly<Record<GunId, number>> = {
  deagle: 0.07,
  awp: 0.09,
};

interface ShotEffectProfile {
  tracerColor: number;
  /** hdr multiplier on the tracer core, bloom turns it into the glow */
  tracerIntensity: number;
  /** metres of bright streak, the shortest a local one gets */
  tracerLength: number;
  /** a local streak grows with the shot distance up to this */
  tracerMaxLength: number;
  /** world width of the ribbon, metres */
  tracerWidth: number;
  tracerMinPixels: number;
  /** how fast the streak crosses the screen, m/s */
  tracerSpeed: number;
  /** shortest time a local tracer object lives */
  tracerMs: number;
  /** faint trail left along the path, 0 = none */
  wakeMs: number;
  flashColor: number;
  flashIntensity: number;
  flashScale: number;
  flashMs: number;
  impactColor: number;
  impactScale: number;
  impactMs: number;
}

interface ActiveEffect {
  object: Object3D;
  parent: Object3D;
  bornMs: number;
  lifetimeMs: number;
  baseOpacity: number;
  holdRatio: number;
  fadePower: number;
  remote: boolean;
  preserveOnDeath?: boolean;
  setOpacity(opacity: number, ageMs: number): void;
  dispose(): void;
}

/**
 * Remote rounds cross the whole distance in `travelMs` no matter how far,
 * so a shot at you is a fast streak with its endpoint cue right behind it.
 */
export const REMOTE_SHOT_EFFECTS = {
  deagle: {
    tracerLength: 2.6,
    tracerMs: 120,
    travelMs: 45,
    muzzleMs: 75,
    impactMs: 380,
    fatalTracerMs: 160,
    fatalImpactMs: 620,
  },
  awp: {
    tracerLength: 5.2,
    tracerMs: 150,
    travelMs: 34,
    muzzleMs: 90,
    impactMs: 420,
    fatalTracerMs: 190,
    fatalImpactMs: 700,
  },
} as const satisfies Readonly<Record<GunId, {
  tracerLength: number;
  tracerMs: number;
  travelMs: number;
  muzzleMs: number;
  impactMs: number;
  fatalTracerMs: number;
  fatalImpactMs: number;
}>>;

export const SHOT_EFFECT_PROFILES: Readonly<Record<GunId, ShotEffectProfile>> = {
  deagle: {
    tracerColor: 0xffae4a,
    tracerIntensity: 4.2,
    tracerLength: 3.2,
    tracerMaxLength: 14,
    tracerWidth: 0.006,
    tracerMinPixels: 2.4,
    tracerSpeed: 950,
    tracerMs: 90,
    wakeMs: 0,
    flashColor: 0xffb45c,
    flashIntensity: 9,
    flashScale: 0.1,
    flashMs: 70,
    impactColor: 0xffd29a,
    impactScale: 0.1,
    impactMs: 180,
  },
  awp: {
    tracerColor: 0xffe2b0,
    tracerIntensity: 7,
    tracerLength: 6.5,
    tracerMaxLength: 24,
    tracerWidth: 0.01,
    tracerMinPixels: 3.2,
    tracerSpeed: 1500,
    tracerMs: 110,
    wakeMs: 520,
    flashColor: 0xffd49a,
    flashIntensity: 12,
    flashScale: 0.14,
    flashMs: 85,
    impactColor: 0xfff0c8,
    impactScale: 0.13,
    impactMs: 220,
  },
};

/** shortest flight of a local round, so a wall at arm's length still shows the streak */
const LOCAL_MIN_TRAVEL_MS = 14;

const LOCAL_MUZZLE_ANCHORS: Readonly<Record<GunId, readonly [number, number, number]>> = {
  deagle: [0.075, -0.065, -0.46],
  awp: [0.11, -0.095, -0.5],
};

interface SurfaceLook {
  sparks: number;
  dust: number;
  debris: number;
  dustColor: [number, number, number];
  debrisColor: [number, number, number];
}

/** what a hit throws up, per surface */
const SURFACE_LOOKS: Readonly<Record<SurfaceKind, SurfaceLook>> = {
  metal: { sparks: 11, dust: 3, debris: 0, dustColor: [0.46, 0.46, 0.47], debrisColor: [0.2, 0.2, 0.21] },
  concrete: { sparks: 3, dust: 7, debris: 6, dustColor: [0.62, 0.6, 0.56], debrisColor: [0.36, 0.35, 0.33] },
  stone: { sparks: 3, dust: 7, debris: 6, dustColor: [0.68, 0.56, 0.42], debrisColor: [0.4, 0.3, 0.21] },
  sand: { sparks: 0, dust: 10, debris: 7, dustColor: [0.8, 0.66, 0.46], debrisColor: [0.55, 0.43, 0.28] },
  wood: { sparks: 0, dust: 4, debris: 8, dustColor: [0.5, 0.38, 0.25], debrisColor: [0.3, 0.2, 0.11] },
  glass: { sparks: 6, dust: 2, debris: 6, dustColor: [0.7, 0.75, 0.78], debrisColor: [0.6, 0.7, 0.75] },
  emissive: { sparks: 7, dust: 1, debris: 0, dustColor: [0.5, 0.5, 0.5], debrisColor: [0.2, 0.2, 0.2] },
  generic: { sparks: 4, dust: 6, debris: 4, dustColor: [0.6, 0.58, 0.54], debrisColor: [0.33, 0.32, 0.3] },
};

const SPARKS: BurstStyle = { additive: true, gravity: -9.8, drag: 1.4, stretch: 0.014 };
const DEBRIS: BurstStyle = { additive: false, gravity: -9.8, drag: 0.7, stretch: 0.003 };

function hdr(hex: number, intensity: number): Color {
  return new Color(hex).multiplyScalar(intensity);
}

/** Weapon-authored world feedback with deterministic expiry and disposal. */
export class CombatEffects {
  private readonly active: ActiveEffect[] = [];

  private readonly flashTexture: DataTexture = createFlashTexture();
  private puffTexture: DataTexture | null = null;
  private readonly decals: ImpactDecals | null;
  private readonly random: () => number;
  private density = 1;
  private readonly resolution = new Vector2(1920, 1080);
  private lastLocalShotMs: number | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly localMuzzleParent: Object3D | null = null,
    private readonly options: CombatEffectsOptions = {},
  ) {
    this.random = options.random ?? Math.random;
    this.decals = options.impactEffects
      ? new ImpactDecals(scene, { random: this.random })
      : null;
  }

  public setQuality(preset: QualityPreset): void {
    this.density = preset.effectDensity;
    this.decals?.setMaxDecals(preset.maxDecals);
  }

  /** drawing buffer size, so tracer widths are right in pixels */
  public setResolution(width: number, height: number): void {
    this.resolution.set(Math.max(1, width), Math.max(1, height));
  }

  /** birth time of the newest local shot, for frame exact screenshot freezes */
  public getLastLocalShotMs(): number | null {
    return this.lastLocalShotMs;
  }

  public spawnShot(request: ShotEffectRequest): void {
    const profile = SHOT_EFFECT_PROFILES[request.weaponId];
    if (!request.remote) this.lastLocalShotMs = request.nowMs;
    const direction = request.to.clone().sub(request.from);
    const distance = direction.length();
    if (distance < 1e-5) {
      return;
    }
    direction.multiplyScalar(1 / distance);

    const travelMs = this.spawnTracer(request, profile);
    this.spawnMuzzle(request, direction, profile);
    if (request.impactNormal) {
      this.spawnImpact(request, profile);
    }
    if (!this.options.impactEffects) {
      return;
    }
    this.spawnMuzzleSmoke(request, direction);
    const arriveMs = request.nowMs + travelMs;
    if (request.impactKind === 'world' && request.impactNormal) {
      const surface = this.options.resolveSurface?.(request.to, direction) ?? 'generic';
      this.spawnBulletHole(request.to, request.impactNormal, request.weaponId, request.nowMs, surface);
      this.spawnSurfaceBurst(request.to, request.impactNormal, direction, surface, arriveMs, request.weaponId);
    } else if (request.impactKind === 'player') {
      this.spawnBloodAt(request.to, direction, arriveMs);
    }
  }

  /** pooled bullet hole on world geometry (needs `impactEffects`) */
  public spawnBulletHole(point: Vector3, normal: Vector3, weaponId: GunId, nowMs: number, surface: SurfaceKind = 'generic'): void {
    this.decals?.spawn(point, normal, DECAL_SIZE_M[weaponId], nowMs, surface);
  }

  /** short dust and spark puff where a round hit the world */
  public spawnDust(point: Vector3, normal: Vector3, nowMs: number, surface: SurfaceKind = 'generic'): void {
    this.spawnSurfaceBurst(point, normal, normal.clone().negate(), surface, nowMs, 'deagle');
  }

  /**
   * Blood puff at a server-confirmed player hit. `direction` is the incoming
   * shot; most of the spray carries on through, a little comes back out.
   */
  public spawnBlood(point: Vector3, direction: Vector3, nowMs: number): void {
    this.spawnBloodAt(point, direction, nowMs);
  }

  /** removes every bullet hole (map changes); transient effects are untouched */
  public clearDecals(): void {
    this.decals?.clear();
  }

  public getDecalCount(): number {
    return this.decals?.getActiveCount() ?? 0;
  }

  private count(base: number): number {
    return base <= 0 ? 0 : Math.max(1, Math.round(base * this.density));
  }

  private jitter(scale: number): number {
    return (this.random() * 2 - 1) * scale;
  }

  /** returns how long the round takes to reach `to`, ms */
  private spawnTracer(request: ShotEffectRequest, profile: ShotEffectProfile): number {
    const remote = request.remote === true;
    let origin = request.from;
    if (!remote) {
      const drawn = this.options.getLocalTracerOrigin?.(request.weaponId);
      if (drawn && Number.isFinite(drawn.x + drawn.y + drawn.z) && drawn.distanceTo(request.to) > 0.05) {
        origin = drawn;
      }
    }
    const path = request.to.clone().sub(origin);
    const distance = path.length();
    if (distance < 1e-5) return 0;
    const direction = path.multiplyScalar(1 / distance);
    const remoteProfile = REMOTE_SHOT_EFFECTS[request.weaponId];
    // a local round flies away from the eye and shrinks to a dot on screen, so
    // its first frame is a long streak out of the barrel that then rushes on
    const length = remote
      ? Math.min(distance, remoteProfile.tracerLength)
      : Math.min(distance, Math.max(profile.tracerLength, Math.min(profile.tracerMaxLength, distance * 0.35)));
    // remote: the head reaches the endpoint in exactly travelMs. local: the
    // streak starts as [muzzle, length] and both ends move at tracerSpeed.
    const travelMs = remote
      ? remoteProfile.travelMs
      : Math.max(LOCAL_MIN_TRAVEL_MS, ((distance - length) / profile.tracerSpeed) * 1000);
    const speed = remote
      ? distance / Math.max(1e-3, travelMs / 1000)
      : profile.tracerSpeed;
    const intensity = profile.tracerIntensity * (remote ? 0.85 : 1);
    const ribbon = new TracerRibbon({
      core: hdr(profile.tracerColor, intensity),
      glow: hdr(profile.tracerColor, intensity * 0.55),
      width: profile.tracerWidth * (remote ? 1.6 : 1),
      minPixels: profile.tracerMinPixels * (remote ? 1.25 : 1),
      resolution: this.resolution,
      headBias: request.weaponId === 'awp' ? 1.1 : 1.5,
    });
    ribbon.userData.effectType = 'tracer';
    ribbon.userData.weaponId = request.weaponId;
    ribbon.userData.segmentLength = length;
    ribbon.userData.endpoint = request.to.toArray();
    ribbon.userData.travelMs = travelMs;
    const tail = new Vector3();
    const head = new Vector3();
    const place = (ageMs: number) => {
      const t = Math.max(0, ageMs) / 1000;
      let headAt: number;
      let tailAt: number;
      if (remote) {
        const travelled = speed * t;
        headAt = Math.min(distance, Math.max(length * 0.25, travelled));
        tailAt = Math.min(headAt, Math.max(0, travelled - length));
      } else {
        // short shots still sweep for LOCAL_MIN_TRAVEL_MS
        const sweep = Math.min(speed, Math.max(1, distance - length) / (travelMs / 1000));
        headAt = Math.min(distance, length + sweep * t);
        tailAt = Math.min(headAt, sweep * t);
      }
      head.copy(origin).addScaledVector(direction, headAt);
      tail.copy(origin).addScaledVector(direction, tailAt);
      ribbon.setSegment(tail, head);
      return { headAt, tailAt };
    };
    place(0);
    let wake: TracerRibbon | null = null;
    if (profile.wakeMs > 0) {
      // the awp leaves a faint heat trail along the path that hangs for half a second
      wake = new TracerRibbon({
        core: hdr(profile.tracerColor, 2.2),
        glow: hdr(0xc8d6e6, 0.9),
        width: profile.tracerWidth * 2.4,
        minPixels: 2.2,
        resolution: this.resolution,
        headBias: 0.6,
      });
      wake.userData.effectType = 'tracer-wake';
      wake.setSegment(origin, head);
      ribbon.add(wake);
    }
    const lifetimeMs = remote
      ? request.fatal ? remoteProfile.fatalTracerMs : remoteProfile.tracerMs
      : Math.max(profile.tracerMs, travelMs + (length / speed) * 1000 + 30, profile.wakeMs);
    ribbon.userData.clearMs = remote ? travelMs + (length / speed) * 1000 : travelMs + (length / speed) * 1000;
    this.scene.add(onEffectsLayer(ribbon));
    this.active.push({
      object: ribbon,
      parent: this.scene,
      bornMs: request.nowMs,
      lifetimeMs,
      baseOpacity: 1,
      holdRatio: 0.7,
      fadePower: 1,
      remote,
      preserveOnDeath: remote && request.fatal === true,
      setOpacity: (opacity, ageMs) => {
        const { headAt, tailAt } = place(ageMs);
        // once the tail reaches the endpoint the streak is gone
        const alive = headAt - tailAt > 1e-3 ? 1 : 0;
        ribbon.setIntensity(opacity * alive);
        if (wake) {
          const since = Math.max(0, ageMs - travelMs);
          const fade = Math.max(0, 1 - since / profile.wakeMs);
          wake.setSegment(origin, head);
          wake.setIntensity(fade * fade * Math.min(1, ageMs / 20));
        }
      },
      dispose: () => {
        ribbon.dispose();
        wake?.dispose();
      },
    });
    return travelMs;
  }

  private spawnMuzzle(request: ShotEffectRequest, direction: Vector3, profile: ShotEffectProfile): void {
    const group = new Group();
    const remote = request.remote === true;
    const coreMaterial = new SpriteMaterial({
      color: hdr(profile.flashColor, profile.flashIntensity),
      map: this.flashTexture,
      transparent: true,
      opacity: 1,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: true,
    });
    coreMaterial.rotation = this.random() * Math.PI * 2;
    const core = new Sprite(coreMaterial);
    this.puffTexture ??= createPuffTexture();
    const glowMaterial = new SpriteMaterial({
      color: hdr(profile.flashColor, profile.flashIntensity * 0.22),
      map: this.puffTexture,
      transparent: true,
      opacity: 1,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: true,
    });
    const glow = new Sprite(glowMaterial);
    group.add(glow, core);
    // Local muzzle feedback belongs to the first-person layer. A world-space
    // flash is otherwise overwritten by the later clearDepth + viewmodel pass.
    // Remote flashes continue to live at their physical world muzzle.
    const forwardOffset = remote ? 0.32 : 0.22;
    const overlayParent = remote ? null : this.localMuzzleParent;
    const parent = overlayParent ?? this.scene;
    const socket = remote
      ? null
      : this.options.getLocalMuzzleWorldPosition?.(request.weaponId) ?? null;
    const validSocket = socket && Number.isFinite(socket.x + socket.y + socket.z) ? socket : null;
    if (overlayParent) {
      if (validSocket) {
        overlayParent.updateWorldMatrix(true, false);
        group.position.copy(overlayParent.worldToLocal(validSocket.clone()));
      } else {
        group.position.set(...LOCAL_MUZZLE_ANCHORS[request.weaponId]);
      }
    } else if (validSocket) {
      group.position.copy(validSocket);
    } else {
      group.position.copy(request.from).addScaledVector(direction, forwardOffset);
    }
    const scale = profile.flashScale * (remote ? 3.3 : overlayParent ? 1.05 : 1);
    const stretch = 1.1 + this.random() * 0.35;
    group.frustumCulled = false;
    core.renderOrder = overlayParent ? 21 : 3;
    glow.renderOrder = overlayParent ? 20 : 3;
    group.userData.effectType = 'muzzle';
    group.userData.weaponId = request.weaponId;
    group.userData.origin = request.from.toArray();
    group.userData.forwardOffset = forwardOffset;
    parent.add(parent === this.scene ? onEffectsLayer(group) : group);
    if (!remote) this.options.onLocalMuzzleFlash?.(request.weaponId);
    const lifetimeMs = remote ? REMOTE_SHOT_EFFECTS[request.weaponId].muzzleMs : profile.flashMs;
    const apply = (opacity: number, ageMs: number) => {
      // a hard pop that swells a touch while it burns out
      const t = Math.min(1, ageMs / lifetimeMs);
      const swell = 0.75 + 0.4 * Math.sqrt(t);
      core.scale.set(scale * stretch * swell, scale * swell, 1);
      glow.scale.setScalar(scale * 2.6 * (0.8 + 0.5 * t));
      coreMaterial.opacity = opacity;
      glowMaterial.opacity = opacity * (1 - t * 0.5);
    };
    apply(1, 0);
    this.active.push({
      object: group,
      parent,
      bornMs: request.nowMs,
      lifetimeMs,
      baseOpacity: 1,
      // Preserve the sharp flash onset; the swell and fade cover the next frames.
      holdRatio: 0.3,
      fadePower: 1.8,
      remote,
      preserveOnDeath: remote && request.fatal === true,
      setOpacity: apply,
      dispose: () => {
        coreMaterial.dispose();
        glowMaterial.dispose();
      },
    });
  }

  private spawnMuzzleSmoke(request: ShotEffectRequest, direction: Vector3): void {
    let origin = request.from;
    if (!request.remote) {
      const drawn = this.options.getLocalTracerOrigin?.(request.weaponId);
      if (drawn && Number.isFinite(drawn.x + drawn.y + drawn.z)) origin = drawn;
    }
    this.puffTexture ??= createPuffTexture();
    const light = this.lightFactor(origin);
    const count = this.count(request.weaponId === 'awp' ? 7 : 5);
    const particles: Particle[] = [];
    for (let i = 0; i < count; i += 1) {
      const grey = (0.55 + this.random() * 0.15) * light;
      particles.push({
        offset: direction.clone().multiplyScalar(0.05 + this.random() * 0.12),
        velocity: direction.clone().multiplyScalar(0.8 + this.random() * 1.6)
          .add(new Vector3(this.jitter(0.25), 0.15 + this.random() * 0.3, this.jitter(0.25))),
        color: new Color(grey, grey, grey * 1.02),
        opacity: 0.1 + this.random() * 0.08,
        startSize: 0.05,
        endSize: 0.32 + this.random() * 0.25,
        lifetime: 0.7 + this.random() * 0.6,
        seed: this.random(),
      });
    }
    this.addBurst('muzzle-smoke', origin, particles, { additive: false, gravity: 0.25, drag: 2.6, stretch: 0, map: this.puffTexture }, request.nowMs, request.remote === true);
  }

  /** sparks, dust and chips thrown off a world hit, shaped by what was hit */
  private spawnSurfaceBurst(
    point: Vector3,
    normal: Vector3,
    incoming: Vector3,
    surface: SurfaceKind,
    bornMs: number,
    weaponId: GunId,
  ): void {
    if (!Number.isFinite(point.x + point.y + point.z) || normal.lengthSq() < 1e-10) return;
    const look = SURFACE_LOOKS[surface] ?? SURFACE_LOOKS.generic;
    const n = normal.clone().normalize();
    const heavy = weaponId === 'awp' ? 1.35 : 1;
    // rounds glance off along the reflected direction
    const reflected = incoming.clone().normalize().reflect(n);
    const light = this.lightFactor(point.clone().addScaledVector(n, 0.05));
    const origin = point.clone().addScaledVector(n, 0.02);

    const sparkCount = this.count(look.sparks * heavy);
    if (sparkCount > 0) {
      const sparks: Particle[] = [];
      for (let i = 0; i < sparkCount; i += 1) {
        const dir = reflected.clone().multiplyScalar(0.6).add(n.clone().multiplyScalar(0.7))
          .add(new Vector3(this.jitter(0.7), this.jitter(0.7), this.jitter(0.7))).normalize();
        const hot = 4 + this.random() * 6;
        sparks.push({
          offset: new Vector3(),
          velocity: dir.multiplyScalar(3 + this.random() * 6),
          color: new Color(1, 0.62 + this.random() * 0.2, 0.3).multiplyScalar(hot),
          opacity: 1,
          startSize: 0.014 + this.random() * 0.008,
          endSize: 0.006,
          lifetime: 0.1 + this.random() * 0.28,
          seed: this.random(),
        });
      }
      this.addBurst('impact-sparks', origin, sparks, SPARKS, bornMs, false);
    }

    const dustCount = this.count(look.dust * heavy);
    if (dustCount > 0) {
      this.puffTexture ??= createPuffTexture();
      const dust: Particle[] = [];
      for (let i = 0; i < dustCount; i += 1) {
        const dir = n.clone().multiplyScalar(0.9).add(new Vector3(this.jitter(0.55), this.jitter(0.55), this.jitter(0.55))).normalize();
        const tone = 0.85 + this.random() * 0.3;
        dust.push({
          offset: dir.clone().multiplyScalar(0.02),
          velocity: dir.multiplyScalar(0.4 + this.random() * 1.6),
          color: new Color(look.dustColor[0] * tone * light, look.dustColor[1] * tone * light, look.dustColor[2] * tone * light),
          opacity: 0.32 + this.random() * 0.22,
          startSize: 0.05 + this.random() * 0.04,
          endSize: (0.3 + this.random() * 0.3) * heavy,
          lifetime: 0.55 + this.random() * 0.6,
          seed: this.random(),
        });
      }
      this.addBurst('impact-dust', origin, dust, { additive: false, gravity: -0.35, drag: 3.2, stretch: 0, map: this.puffTexture }, bornMs, false);
    }

    const debrisCount = this.count(look.debris * heavy);
    if (debrisCount > 0) {
      const debris: Particle[] = [];
      for (let i = 0; i < debrisCount; i += 1) {
        const dir = n.clone().add(reflected.clone().multiplyScalar(0.3))
          .add(new Vector3(this.jitter(0.8), this.jitter(0.8), this.jitter(0.8))).normalize();
        const tone = (0.7 + this.random() * 0.5) * light;
        debris.push({
          offset: new Vector3(),
          velocity: dir.multiplyScalar(1.8 + this.random() * 3.5),
          color: new Color(look.debrisColor[0] * tone, look.debrisColor[1] * tone, look.debrisColor[2] * tone),
          opacity: 0.95,
          startSize: 0.012 + this.random() * 0.014,
          endSize: 0.01,
          lifetime: 0.35 + this.random() * 0.45,
          seed: this.random(),
        });
      }
      this.addBurst('impact-debris', origin, debris, DEBRIS, bornMs, false);
    }
  }

  private spawnBloodAt(point: Vector3, direction: Vector3, bornMs: number): void {
    if (direction.lengthSq() < 1e-10 || !Number.isFinite(point.x + point.y + point.z)) {
      return;
    }
    this.puffTexture ??= createPuffTexture();
    const through = direction.clone().normalize();
    const light = this.lightFactor(point);
    const mist: Particle[] = [];
    const mistCount = this.count(7);
    for (let i = 0; i < mistCount; i += 1) {
      // most of it carries on through, some sprays back out of the wound
      const back = i < 2 ? -0.6 : 1;
      const dir = through.clone().multiplyScalar(back).add(new Vector3(this.jitter(0.45), this.jitter(0.45), this.jitter(0.45))).normalize();
      const red = (0.32 + this.random() * 0.12) * light;
      mist.push({
        offset: new Vector3(),
        velocity: dir.multiplyScalar(0.6 + this.random() * 1.8),
        color: new Color(red, red * 0.06, red * 0.05),
        opacity: 0.6 + this.random() * 0.25,
        startSize: 0.05,
        endSize: 0.22 + this.random() * 0.16,
        lifetime: 0.32 + this.random() * 0.28,
        seed: this.random(),
      });
    }
    this.addBurst('blood', point, mist, { additive: false, gravity: -3, drag: 3, stretch: 0, map: this.puffTexture }, bornMs, false);
    const drops: Particle[] = [];
    const dropCount = this.count(9);
    for (let i = 0; i < dropCount; i += 1) {
      const dir = through.clone().add(new Vector3(this.jitter(0.6), this.jitter(0.4) + 0.2, this.jitter(0.6))).normalize();
      const red = (0.25 + this.random() * 0.1) * light;
      drops.push({
        offset: new Vector3(),
        velocity: dir.multiplyScalar(1.5 + this.random() * 3),
        color: new Color(red, red * 0.04, red * 0.04),
        opacity: 0.95,
        startSize: 0.012 + this.random() * 0.01,
        endSize: 0.008,
        lifetime: 0.35 + this.random() * 0.3,
        seed: this.random(),
      });
    }
    this.addBurst('blood', point, drops, DEBRIS, bornMs, false);
  }

  private lightFactor(point: Vector3): number {
    const lit = this.options.lightAt?.(point);
    // shade still gets sky light, so never go fully dark
    return typeof lit === 'number' && Number.isFinite(lit) ? 0.42 + 0.58 * Math.min(1, Math.max(0, lit)) : 1;
  }

  private addBurst(
    effectType: string,
    origin: Vector3,
    particles: Particle[],
    style: BurstStyle,
    bornMs: number,
    remote: boolean,
  ): void {
    if (particles.length === 0) return;
    const burst = new ParticleBurst(origin, particles, style);
    burst.userData.effectType = effectType;
    this.scene.add(onEffectsLayer(burst));
    this.active.push({
      object: burst,
      parent: this.scene,
      bornMs,
      lifetimeMs: burst.lifetime * 1000,
      baseOpacity: 1,
      holdRatio: 1,
      fadePower: 1,
      remote,
      setOpacity: (_opacity, ageMs) => burst.setAge(ageMs / 1000),
      dispose: () => burst.dispose(),
    });
  }

  private spawnImpact(request: ShotEffectRequest, profile: ShotEffectProfile): void {
    if (request.remote) {
      // A remote player-hit endpoint can sit almost on the victim camera.
      // Use a compact, depth-tested arrival spark just in front of the surface.
      this.spawnRemoteImpactGlow(request, profile);
      return;
    }
    const normal = request.impactNormal?.clone().normalize() ?? new Vector3(0, 1, 0);
    const distance = request.from.distanceTo(request.to);
    // a hot pop where the round lands, a little bigger far away so it reads
    // next to the crosshair, capped so a long miss never becomes a billboard
    const scale = Math.min(0.42, Math.max(profile.impactScale, distance * 0.0045));
    const material = new SpriteMaterial({
      color: hdr(profile.impactColor, 5),
      map: this.flashTexture,
      transparent: true,
      opacity: 1,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: true,
    });
    material.rotation = this.random() * Math.PI * 2;
    const flash = new Sprite(material);
    flash.position.copy(request.to).addScaledVector(normal, 0.03);
    flash.scale.setScalar(scale);
    flash.frustumCulled = false;
    flash.renderOrder = 3;
    flash.userData.effectType = 'impact';
    flash.userData.weaponId = request.weaponId;
    flash.userData.radius = scale * 0.5;
    this.scene.add(onEffectsLayer(flash));
    this.active.push({
      object: flash,
      parent: this.scene,
      bornMs: request.nowMs,
      lifetimeMs: profile.impactMs,
      baseOpacity: 1,
      holdRatio: 0.3,
      fadePower: 1.6,
      remote: false,
      setOpacity: (opacity, ageMs) => {
        material.opacity = opacity;
        flash.scale.setScalar(scale * (0.8 + 0.5 * Math.min(1, ageMs / profile.impactMs)));
      },
      dispose: () => {
        material.dispose();
      },
    });
  }

  /**
   * A player hit endpoint can be only a few centimetres from the victim camera
   * and below its frustum. Place a compact arrival spark just behind it along
   * the incoming ray, shown when the round gets there.
   */
  private spawnRemoteImpactGlow(
    request: ShotEffectRequest,
    profile: ShotEffectProfile,
  ): void {
    const incoming = request.to.clone().sub(request.from);
    const distance = incoming.length();
    if (distance < 1e-5) return;
    incoming.multiplyScalar(1 / distance);

    const material = new SpriteMaterial({
      color: hdr(profile.impactColor, 4),
      map: this.flashTexture,
      transparent: true,
      opacity: 1,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: true,
    });
    material.rotation = this.random() * Math.PI * 2;
    const spark = new Sprite(material);
    const backstep = Math.min(0.32, Math.max(0.12, distance * 0.025));
    spark.position.copy(request.to).addScaledVector(incoming, -backstep);
    const scale = request.weaponId === 'awp' ? 0.09 : 0.085;
    spark.scale.set(scale, scale, 1);
    spark.frustumCulled = false;
    spark.renderOrder = 3;
    spark.userData.effectType = 'impact-glow';
    spark.userData.weaponId = request.weaponId;
    spark.userData.endpoint = request.to.toArray();
    // The impact is an arrival cue, not a second muzzle flash. Hold it until the
    // round reaches the authoritative endpoint.
    spark.visible = false;
    this.scene.add(onEffectsLayer(spark));
    this.active.push({
      object: spark,
      parent: this.scene,
      bornMs: request.nowMs + REMOTE_SHOT_EFFECTS[request.weaponId].travelMs,
      lifetimeMs: request.fatal
        ? REMOTE_SHOT_EFFECTS[request.weaponId].fatalImpactMs
        : REMOTE_SHOT_EFFECTS[request.weaponId].impactMs,
      baseOpacity: 0.95,
      holdRatio: request.fatal ? 0.35 : 0.25,
      fadePower: request.fatal ? 1.2 : 1.5,
      remote: true,
      preserveOnDeath: request.fatal === true,
      setOpacity: (opacity) => { material.opacity = opacity; },
      dispose: () => { material.dispose(); },
    });
  }

  public update(nowMs: number): void {
    this.decals?.update(nowMs);
    for (let i = this.active.length - 1; i >= 0; i -= 1) {
      const effect = this.active[i];
      if (nowMs < effect.bornMs) {
        effect.object.visible = false;
        continue;
      }
      effect.object.visible = true;
      const age = Math.max(0, nowMs - effect.bornMs);
      if (age >= effect.lifetimeMs) {
        this.removeAt(i);
        continue;
      }
      const remaining = 1 - age / effect.lifetimeMs;
      // Each cue gets a short full-opacity read followed by a smooth authored fade.
      const fade = age <= effect.lifetimeMs * effect.holdRatio
        ? 1
        : Math.max(0, remaining / Math.max(1e-6, 1 - effect.holdRatio)) ** effect.fadePower;
      effect.setOpacity(effect.baseOpacity * fade, age);
    }
  }

  /**
   * Clears stale/local feedback on death but preserves the just-arrived remote
   * round long enough to render. Respawn and disposal still call {@link clear}.
   */
  public clearForDeath(nowMs: number, preserveRecentRemoteMs = 120): void {
    for (let i = this.active.length - 1; i >= 0; i -= 1) {
      const effect = this.active[i];
      const ageMs = nowMs - effect.bornMs;
      const recentRemote = effect.remote && ageMs <= preserveRecentRemoteMs;
      const fatalCue = effect.preserveOnDeath === true && ageMs < effect.lifetimeMs;
      if (!recentRemote && !fatalCue) {
        this.removeAt(i);
      }
    }
  }

  public clear(): void {
    for (let i = this.active.length - 1; i >= 0; i -= 1) {
      this.removeAt(i);
    }
  }

  public getActiveCount(): number {
    return this.active.length;
  }

  private removeAt(index: number): void {
    const effect = this.active[index];
    effect.parent.remove(effect.object);
    effect.dispose();
    this.active.splice(index, 1);
  }

  public dispose(): void {
    this.clear();
    this.decals?.dispose();
    this.flashTexture.dispose();
    this.puffTexture?.dispose();
    this.puffTexture = null;
  }
}
