import {
  AdditiveBlending,
  CylinderGeometry,
  DataTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  Object3D,
  Quaternion,
  RGBAFormat,
  RingGeometry,
  Scene,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';
import type { FirearmId as GunId } from './FirearmTiming';
import { ImpactDecals } from './ImpactDecals';

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
  /** bullet holes, dust and blood puffs; off keeps bare instances to tracers, flashes and rings */
  impactEffects?: boolean;
  /**
   * Real muzzle socket of the local first-person gun, in the space of the
   * viewmodel layer's world (the layer passed as `localMuzzleParent`). Null
   * falls back to the fixed camera-space anchors.
   */
  getLocalMuzzleWorldPosition?: (weapon: GunId) => Vector3 | null;
  /** random source for decal spin and particles */
  random?: () => number;
}

/** bullet hole size per weapon, metres (visual choice, .50 AE and .338 read larger than life) */
export const DECAL_SIZE_M: Readonly<Record<GunId, number>> = {
  deagle: 0.07,
  awp: 0.09,
};

interface PuffStyle {
  count: number;
  color: number;
  opacity: number;
  additive: boolean;
  startSize: number;
  endSize: number;
  minSpeed: number;
  maxSpeed: number;
  /** 0 = along the given direction only, 1 = anywhere in the hemisphere */
  scatter: number;
  gravity: number;
  drag: number;
  lifetimeMs: number;
}

const DUST_PUFF: PuffStyle = {
  count: 5,
  color: 0xb6a891,
  opacity: 0.5,
  additive: false,
  startSize: 0.05,
  endSize: 0.24,
  minSpeed: 0.6,
  maxSpeed: 1.6,
  scatter: 0.55,
  gravity: -0.6,
  drag: 3.2,
  lifetimeMs: 480,
};

const IMPACT_SPARKS: PuffStyle = {
  count: 3,
  color: 0xffd08a,
  opacity: 0.95,
  additive: true,
  startSize: 0.03,
  endSize: 0.012,
  minSpeed: 2.5,
  maxSpeed: 5,
  scatter: 0.8,
  gravity: -9,
  drag: 1.5,
  lifetimeMs: 160,
};

const BLOOD_PUFF: PuffStyle = {
  count: 6,
  color: 0x8e0f0f,
  opacity: 0.8,
  additive: false,
  startSize: 0.05,
  endSize: 0.17,
  minSpeed: 0.5,
  maxSpeed: 2.2,
  scatter: 0.45,
  gravity: -6,
  drag: 2.5,
  lifetimeMs: 420,
};

interface ShotEffectProfile {
  tracerColor: number;
  tracerLength: number;
  tracerWidth: number;
  tracerMs: number;
  flashColor: number;
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

export const REMOTE_SHOT_EFFECTS = {
  deagle: {
    tracerLength: 2.1,
    tracerMs: 720,
    travelMs: 420,
    muzzleMs: 230,
    impactMs: 900,
    fatalTracerMs: 820,
    fatalImpactMs: 1050,
  },
  awp: {
    tracerLength: 3.7,
    tracerMs: 820,
    travelMs: 460,
    muzzleMs: 260,
    impactMs: 1050,
    fatalTracerMs: 920,
    fatalImpactMs: 1200,
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
    tracerColor: 0xffb35c,
    tracerLength: 2.8,
    tracerWidth: 0.016,
    tracerMs: 620,
    flashColor: 0xff8a35,
    flashScale: 0.095,
    flashMs: 190,
    impactColor: 0xffb45b,
    impactScale: 0.16,
    impactMs: 1500,
  },
  awp: {
    tracerColor: 0xd9efff,
    tracerLength: 6.2,
    tracerWidth: 0.023,
    tracerMs: 760,
    flashColor: 0xffe0a0,
    flashScale: 0.13,
    flashMs: 220,
    impactColor: 0xffe7bd,
    impactScale: 0.22,
    impactMs: 1700,
  },
};

const FLASH_TEXTURE_SIZE = 16;
const LOCAL_MUZZLE_ANCHORS: Readonly<Record<GunId, readonly [number, number, number]>> = {
  deagle: [0.075, -0.065, -0.46],
  awp: [0.11, -0.095, -0.5],
};

function createFlashTexture(): DataTexture {
  const pixels = new Uint8Array(FLASH_TEXTURE_SIZE * FLASH_TEXTURE_SIZE * 4);
  for (let y = 0; y < FLASH_TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < FLASH_TEXTURE_SIZE; x += 1) {
      const dx = ((x + 0.5) / FLASH_TEXTURE_SIZE) * 2 - 1;
      const dy = ((y + 0.5) / FLASH_TEXTURE_SIZE) * 2 - 1;
      const radial = Math.max(0, 1 - Math.hypot(dx, dy));
      const streak = Math.max(0, 1 - Math.abs(dy) * 5) * Math.max(0, 1 - Math.abs(dx));
      const alpha = Math.max(radial * radial, streak * 0.42);
      const offset = (y * FLASH_TEXTURE_SIZE + x) * 4;
      pixels[offset] = 255;
      pixels[offset + 1] = 255;
      pixels[offset + 2] = 255;
      pixels[offset + 3] = Math.round(alpha * 255);
    }
  }
  const texture = new DataTexture(pixels, FLASH_TEXTURE_SIZE, FLASH_TEXTURE_SIZE, RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

/** soft round particle, used by dust and blood */
function createPuffTexture(): DataTexture {
  const size = 16;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = ((x + 0.5) / size) * 2 - 1;
      const dy = ((y + 0.5) / size) * 2 - 1;
      const falloff = Math.max(0, 1 - Math.hypot(dx, dy));
      const offset = (y * size + x) * 4;
      pixels[offset] = 255;
      pixels[offset + 1] = 255;
      pixels[offset + 2] = 255;
      pixels[offset + 3] = Math.round(falloff ** 1.6 * 255);
    }
  }
  const texture = new DataTexture(pixels, size, size, RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

/** Weapon-authored world feedback with deterministic expiry and disposal. */

export class CombatEffects {
  private readonly active: ActiveEffect[] = [];

  private readonly flashTexture = createFlashTexture();
  private puffTexture: DataTexture | null = null;
  private readonly decals: ImpactDecals | null;
  private readonly random: () => number;

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

  public spawnShot(request: ShotEffectRequest): void {
    const profile = SHOT_EFFECT_PROFILES[request.weaponId];
    const direction = request.to.clone().sub(request.from);
    const distance = direction.length();
    if (distance < 1e-5) {
      return;
    }
    direction.multiplyScalar(1 / distance);

    this.spawnTracer(request, direction, distance, profile);
    this.spawnMuzzle(request, direction, profile);
    if (request.impactNormal) {
      this.spawnImpact(request, profile);
    }
    if (!this.options.impactEffects) {
      return;
    }
    if (request.impactKind === 'world' && request.impactNormal) {
      this.spawnBulletHole(request.to, request.impactNormal, request.weaponId, request.nowMs);
      this.spawnDust(request.to, request.impactNormal, request.nowMs);
    } else if (request.impactKind === 'player') {
      this.spawnBlood(request.to, direction, request.nowMs);
    }
  }

  /** pooled bullet hole on world geometry (needs `impactEffects`) */
  public spawnBulletHole(point: Vector3, normal: Vector3, weaponId: GunId, nowMs: number): void {
    this.decals?.spawn(point, normal, DECAL_SIZE_M[weaponId], nowMs);
  }

  /** short dust and spark puff where a round hit the world */
  public spawnDust(point: Vector3, normal: Vector3, nowMs: number): void {
    this.spawnPuff('impact-dust', DUST_PUFF, point, normal, nowMs);
    this.spawnPuff('impact-sparks', IMPACT_SPARKS, point, normal, nowMs);
  }

  /**
   * Blood puff at a server-confirmed player hit. `direction` is the incoming
   * shot; most of the spray carries on through, a little comes back out.
   */
  public spawnBlood(point: Vector3, direction: Vector3, nowMs: number): void {
    if (direction.lengthSq() < 1e-10) {
      return;
    }
    const through = direction.clone().normalize();
    this.spawnPuff('blood', BLOOD_PUFF, point, through, nowMs);
    this.spawnPuff('blood', { ...BLOOD_PUFF, count: 2, maxSpeed: 1 }, point, through.clone().negate(), nowMs);
  }

  /** removes every bullet hole (map changes); transient effects are untouched */
  public clearDecals(): void {
    this.decals?.clear();
  }

  public getDecalCount(): number {
    return this.decals?.getActiveCount() ?? 0;
  }

  private spawnPuff(
    effectType: string,
    style: PuffStyle,
    point: Vector3,
    direction: Vector3,
    nowMs: number,
  ): void {
    if (!Number.isFinite(point.x + point.y + point.z) || direction.lengthSq() < 1e-10) {
      return;
    }
    this.puffTexture ??= createPuffTexture();
    const axis = direction.clone().normalize();
    const group = new Group();
    group.userData.effectType = effectType;
    group.position.copy(point).addScaledVector(axis, 0.02);
    const materials: SpriteMaterial[] = [];
    const particles: Array<{ sprite: Sprite; velocity: Vector3 }> = [];
    for (let i = 0; i < style.count; i += 1) {
      const material = new SpriteMaterial({
        color: style.color,
        map: this.puffTexture,
        transparent: true,
        opacity: style.opacity,
        blending: style.additive ? AdditiveBlending : NormalBlending,
        depthWrite: false,
        depthTest: true,
      });
      material.rotation = this.random() * Math.PI * 2;
      const sprite = new Sprite(material);
      sprite.scale.setScalar(style.startSize);
      sprite.frustumCulled = false;
      sprite.renderOrder = 3;
      const spray = randomUnit(this.random).multiplyScalar(style.scatter).add(axis).normalize();
      const speed = style.minSpeed + (style.maxSpeed - style.minSpeed) * this.random();
      particles.push({ sprite, velocity: spray.multiplyScalar(speed) });
      materials.push(material);
      group.add(sprite);
    }
    this.scene.add(group);
    this.active.push({
      object: group,
      parent: this.scene,
      bornMs: nowMs,
      lifetimeMs: style.lifetimeMs,
      baseOpacity: style.opacity,
      holdRatio: 0.15,
      fadePower: 1.3,
      remote: false,
      setOpacity: (opacity, ageMs) => {
        const t = ageMs / 1000;
        // closed-form drag and gravity so the puff is frame-rate independent
        const travel = (1 - Math.exp(-style.drag * t)) / style.drag;
        const growth = Math.min(1, ageMs / style.lifetimeMs);
        for (let i = 0; i < particles.length; i += 1) {
          const { sprite, velocity } = particles[i];
          sprite.position.copy(velocity).multiplyScalar(travel);
          sprite.position.y += 0.5 * style.gravity * t * t;
          sprite.scale.setScalar(style.startSize + (style.endSize - style.startSize) * growth);
          materials[i].opacity = opacity;
        }
      },
      dispose: () => {
        for (const material of materials) material.dispose();
      },
    });
  }

  private spawnTracer(
    request: ShotEffectRequest,
    direction: Vector3,
    distance: number,
    profile: ShotEffectProfile,
  ): void {
    const startDistance = Math.min(distance * 0.06, request.remote ? 0.38 : 0.65);
    const maxLength = request.remote
      ? REMOTE_SHOT_EFFECTS[request.weaponId].tracerLength
      : profile.tracerLength;
    const endDistance = Math.min(
      distance,
      request.remote ? startDistance + distance * 0.22 : distance,
      startDistance + maxLength,
    );
    const start = request.from.clone().addScaledVector(direction, startDistance);
    const end = request.from.clone().addScaledVector(direction, endDistance);
    const segmentLength = start.distanceTo(end);
    const width = profile.tracerWidth * (request.remote ? 4.5 : 1);
    const geometry = new CylinderGeometry(
      width,
      width * 0.7,
      segmentLength,
      6,
      1,
      false,
    );
    const material = new MeshBasicMaterial({
      color: profile.tracerColor,
      transparent: true,
      opacity: request.remote ? 0.78 : 0.82,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: true,
    });
    const tracer = new Mesh(geometry, material);
    const initialCenterDistance = startDistance + segmentLength * 0.5;
    const endpointClearance = request.remote
      ? Math.min(0.62, distance * 0.045)
      : 0;
    const finalCenterDistance = Math.max(
      initialCenterDistance,
      distance - segmentLength * 0.5 - endpointClearance,
    );
    tracer.position.copy(request.from).addScaledVector(direction, initialCenterDistance);
    tracer.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), direction);
    tracer.frustumCulled = false;
    tracer.renderOrder = 2;
    tracer.userData.effectType = 'tracer';
    tracer.userData.weaponId = request.weaponId;
    tracer.userData.segmentLength = segmentLength;
    tracer.userData.endpointClearance = endpointClearance;
    tracer.userData.endpoint = request.to.toArray();
    const tracerGlowMaterial = new SpriteMaterial({
      color: profile.tracerColor,
      map: this.flashTexture,
      transparent: true,
      opacity: request.remote ? 0.72 : 0.62,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: true,
    });
    const tracerGlow = new Sprite(tracerGlowMaterial);
    if (request.remote) {
      // A cylinder aimed straight at the viewer foreshortens to a sub-pixel
      // point. Keep one compact additive bead at its midpoint so natural bot
      // rounds remain readable without extending a laser across the full ray.
      const glowScale = this.remoteGlowScale(request.weaponId, distance - initialCenterDistance);
      tracerGlow.scale.set(glowScale * 0.88, glowScale * 1.55, 1);
      tracerGlow.userData.effectType = 'tracer-glow';
    } else {
      // The physical cylinder is almost end-on for a local shot. Keep a compact
      // camera-facing streak before the endpoint, where world depth can still
      // occlude it, instead of putting a bead on the impact surface.
      tracerGlow.position.y = -segmentLength * 0.12;
      tracerGlowMaterial.rotation = request.weaponId === 'awp' ? -0.72 : -0.64;
      const glowWidth = request.weaponId === 'awp' ? 0.036 : 0.027;
      const glowLength = request.weaponId === 'awp' ? 0.17 : 0.12;
      tracerGlow.scale.set(glowWidth, glowLength, 1);
      tracerGlow.userData.effectType = 'tracer-tip';
    }
    tracerGlow.frustumCulled = false;
    tracerGlow.renderOrder = 3;
    tracer.add(tracerGlow);
    this.scene.add(tracer);
    const remoteProfile = REMOTE_SHOT_EFFECTS[request.weaponId];
    this.active.push({
      object: tracer,
      parent: this.scene,
      bornMs: request.nowMs,
      lifetimeMs: request.remote
        ? request.fatal ? remoteProfile.fatalTracerMs : remoteProfile.tracerMs
        : profile.tracerMs,
      baseOpacity: request.remote ? 0.78 : 0.82,
      holdRatio: request.remote ? 0.22 : request.weaponId === 'awp' ? 0.26 : 0.22,
      fadePower: request.remote ? 1 : request.weaponId === 'awp' ? 1 : 0.9,
      remote: request.remote === true,
      preserveOnDeath: request.remote === true && request.fatal === true,
      setOpacity: (opacity, ageMs) => {
        material.opacity = opacity;
        tracerGlowMaterial.opacity = Math.min(request.remote ? 0.72 : 0.62, opacity);
        if (request.remote) {
          const travel = Math.min(1, ageMs / remoteProfile.travelMs);
          const centerDistance =
            initialCenterDistance
            + (finalCenterDistance - initialCenterDistance) * travel;
          tracer.position.copy(request.from).addScaledVector(direction, centerDistance);
          const glowScale = this.remoteGlowScale(
            request.weaponId,
            distance - centerDistance,
          );
          tracerGlow.scale.set(glowScale * 0.88, glowScale * 1.55, 1);
        }
      },
      dispose: () => {
        geometry.dispose();
        material.dispose();
        tracerGlowMaterial.dispose();
      },
    });
  }

  private spawnMuzzle(
    request: ShotEffectRequest,
    direction: Vector3,
    profile: ShotEffectProfile,
  ): void {
    const material = new SpriteMaterial({
      color: profile.flashColor,
      map: this.flashTexture,
      transparent: true,
      opacity: 0.95,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: true,
    });
    const sprite = new Sprite(material);
    // Local muzzle feedback belongs to the first-person layer. A world-space
    // flash is otherwise overwritten by the later clearDepth + viewmodel pass.
    // Remote flashes continue to live at their physical world muzzle.
    const forwardOffset = request.remote ? 0.32 : 0.22;
    const overlayParent = request.remote ? null : this.localMuzzleParent;
    const parent = overlayParent ?? this.scene;
    const socket = request.remote
      ? null
      : this.options.getLocalMuzzleWorldPosition?.(request.weaponId) ?? null;
    const validSocket = socket && Number.isFinite(socket.x + socket.y + socket.z) ? socket : null;
    if (overlayParent) {
      if (validSocket) {
        overlayParent.updateWorldMatrix(true, false);
        sprite.position.copy(overlayParent.worldToLocal(validSocket.clone()));
      } else {
        sprite.position.set(...LOCAL_MUZZLE_ANCHORS[request.weaponId]);
      }
    } else if (validSocket) {
      sprite.position.copy(validSocket);
    } else {
      sprite.position.copy(request.from).addScaledVector(direction, forwardOffset);
    }
    const scale = profile.flashScale * (request.remote ? 3.3 : overlayParent ? 0.46 : 1);
    sprite.scale.set(scale * 1.35, scale, 1);
    sprite.frustumCulled = false;
    sprite.renderOrder = overlayParent ? 20 : 3;
    sprite.userData.effectType = 'muzzle';
    sprite.userData.weaponId = request.weaponId;
    sprite.userData.origin = request.from.toArray();
    sprite.userData.forwardOffset = forwardOffset;
    parent.add(sprite);
    this.active.push({
      object: sprite,
      parent,
      bornMs: request.nowMs,
      lifetimeMs: request.remote
        ? REMOTE_SHOT_EFFECTS[request.weaponId].muzzleMs
        : profile.flashMs,
      baseOpacity: request.remote ? 0.92 : 0.95,
      // Preserve the sharp flash onset; only its compact afterglow spans the
      // following frames, so this never becomes a floating orange disc.
      holdRatio: 0.12,
      fadePower: 2.4,
      remote: request.remote === true,
      preserveOnDeath: request.remote === true && request.fatal === true,
      setOpacity: (opacity) => { material.opacity = opacity; },
      dispose: () => { material.dispose(); },
    });
  }

  private spawnImpact(request: ShotEffectRequest, profile: ShotEffectProfile): void {
    if (request.remote) {
      // A remote player-hit endpoint can sit almost on the victim camera.
      // A world-space ring there expands across most of the viewport; use the
      // compact, depth-tested arrival spark instead. Wall hits remain spatially
      // resolved because the spark is placed just in front of the hit surface.
      this.spawnRemoteImpactGlow(request, profile);
      return;
    }
    // Keep distant wall strikes large enough to read around the fixed crosshair.
    // Nearby ground impacts retain their authored size, while the cap prevents a
    // long-range miss from becoming a billboard-sized decal.
    const distance = request.from.distanceTo(request.to);
    const scale = Math.max(
      profile.impactScale,
      Math.min(0.8, distance * 0.018),
    );
    const geometry = new RingGeometry(scale * 0.38, scale, 16);
    const outlineGeometry = new RingGeometry(scale * 0.66, scale * 1.16, 16);
    const material = new MeshBasicMaterial({
      color: profile.impactColor,
      transparent: true,
      opacity: 0.9,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      side: DoubleSide,
    });
    const outlineMaterial = new MeshBasicMaterial({
      color: 0x07131c,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      depthTest: true,
      side: DoubleSide,
    });
    const normal = request.impactNormal?.clone().normalize() ?? new Vector3(0, 1, 0);
    const ring = new Mesh(geometry, material);
    const outline = new Mesh(outlineGeometry, outlineMaterial);
    outline.position.z = -0.004;
    outline.renderOrder = 1;
    outline.userData.effectType = 'impact-outline';
    ring.add(outline);
    ring.position.copy(request.to).addScaledVector(normal, 0.018);
    ring.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), normal));
    ring.frustumCulled = false;
    ring.renderOrder = 2;
    ring.userData.effectType = 'impact';
    ring.userData.weaponId = request.weaponId;
    this.scene.add(ring);
    this.active.push({
      object: ring,
      parent: this.scene,
      bornMs: request.nowMs,
      lifetimeMs: profile.impactMs,
      baseOpacity: 0.9,
      holdRatio: 0.72,
      fadePower: 1.45,
      remote: false,
      setOpacity: (opacity, ageMs) => {
        material.opacity = opacity;
        outlineMaterial.opacity = Math.min(0.82, opacity * 0.92);
        ring.scale.setScalar(1 + Math.min(0.25, ageMs / profile.impactMs * 0.25));
      },
      dispose: () => {
        geometry.dispose();
        outlineGeometry.dispose();
        material.dispose();
        outlineMaterial.dispose();
      },
    });
  }

  /**
   * A player hit endpoint can be only a few centimetres from the victim camera
   * and below its frustum. Keep the physical ring at the authoritative surface,
   * then place a compact arrival spark just behind it along the incoming ray.
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
      color: profile.impactColor,
      map: this.flashTexture,
      transparent: true,
      opacity: 1,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: true,
    });
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
    // moving short tracer reaches the authoritative endpoint.
    spark.visible = false;
    this.scene.add(spark);
    this.active.push({
      object: spark,
      parent: this.scene,
      bornMs: request.nowMs + REMOTE_SHOT_EFFECTS[request.weaponId].travelMs,
      lifetimeMs: request.fatal
        ? REMOTE_SHOT_EFFECTS[request.weaponId].fatalImpactMs
        : REMOTE_SHOT_EFFECTS[request.weaponId].impactMs,
      baseOpacity: 0.88,
      holdRatio: request.fatal ? 0.42 : 0.34,
      fadePower: request.fatal ? 1.2 : 1.4,
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
      // Each cue gets a short full-opacity read followed by a smooth authored
      // fade. Tracers remain captureable without becoming beams, impacts linger
      // long enough to locate, and muzzle sprites still disappear almost at once.
      const fade = age <= effect.lifetimeMs * effect.holdRatio
        ? 1
        : Math.max(0, remaining / (1 - effect.holdRatio)) ** effect.fadePower;
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

  private remoteGlowScale(weaponId: GunId, remainingDistance: number): number {
    const min = weaponId === 'awp' ? 0.085 : 0.07;
    const max = weaponId === 'awp' ? 0.32 : 0.28;
    return Math.max(min, Math.min(max, remainingDistance * 0.016));
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

/** uniform direction on the unit sphere */
function randomUnit(random: () => number): Vector3 {
  const z = random() * 2 - 1;
  const theta = random() * Math.PI * 2;
  const ring = Math.sqrt(Math.max(0, 1 - z * z));
  return new Vector3(ring * Math.cos(theta), ring * Math.sin(theta), z);
}
