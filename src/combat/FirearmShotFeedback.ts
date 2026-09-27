import { Vector3 } from 'three';
import type { GunId } from '../cosmetics/WeaponViewmodels';
import type { ShotEvent, ShotResult } from '../network/MultiplayerTransport';
import type { CollisionWorld } from '../world/CollisionWorld';
import type { CombatEffects } from './CombatEffects';
import {
  computeWorldMuzzlePosition,
  REMOTE_SHOT_VISUAL_DISTANCE,
} from './ShotPresentation';
import { getWeapon } from './weapons';

type EffectSink = Pick<CombatEffects, 'spawnShot'> & Partial<Pick<CombatEffects, 'spawnBlood'>>;
type ShotCollisionWorld = Pick<CollisionWorld, 'raycastGeometry'>;

/** distance along a ray to the nearest drawn player, or null */
export type PlayerOcclusion = (origin: Vector3, direction: Vector3, maxDistance: number) => number | null;

/** a resolved endpoint this close to the client's own wall hit is that wall */
const SAME_SURFACE_M = 0.1;

export interface FirearmShotPresentation {
  weaponId: GunId;
  origin: Vector3;
  direction: Vector3;
  nowMs: number;
  local: boolean;
  resolvedEndpoint?: Vector3;
  resolvedImpactNormal?: Vector3;
  cameraUp?: Vector3;
  fatal?: boolean;
  /** authority result, for remote shots */
  result?: ShotResult;
  /** false when the confirmed victim is the local player (no blood in our own face) */
  playerImpact?: boolean;
}

export interface FirearmShotContext {
  effects: EffectSink | null;
  collisionWorld: ShotCollisionWorld;
  /**
   * Local shots only: a drawn player in front of the wall stops the visual
   * round there and skips the wall decal; blood waits for the server.
   */
  playerOcclusion?: PlayerOcclusion;
}

export interface RemoteShotHandlerContext extends FirearmShotContext {
  getLocalPlayerId(): string | null;
  nowMs(): number;
}

/**
 * Presents an accepted firearm ray in world space. Authoritative player
 * endpoints win over client geometry only when they remain on the supplied ray
 * and no nearer wall blocks them.
 */
export function presentFirearmShot(
  context: FirearmShotContext,
  request: FirearmShotPresentation,
): boolean {
  if (!context.effects || !isFiniteVector(request.origin) || !isFiniteVector(request.direction)) {
    return false;
  }
  if (request.direction.lengthSq() < 1e-8) {
    return false;
  }

  const forward = request.direction.clone().normalize();
  const maxDistance = Math.min(getWeapon(request.weaponId).range, 4000);
  const worldImpact = context.collisionWorld.raycastGeometry(
    request.origin,
    forward,
    maxDistance,
  );
  const resolvedEndpoint = validResolvedEndpoint(
    request.origin,
    forward,
    maxDistance,
    request.resolvedEndpoint,
  );
  const resolvedDistance = resolvedEndpoint?.distanceTo(request.origin);
  const useResolvedEndpoint =
    resolvedEndpoint !== null
    && resolvedDistance !== undefined
    && (!worldImpact || resolvedDistance <= worldImpact.distance + 0.05);
  const unresolvedVisualDistance = request.local
    ? maxDistance
    : Math.min(maxDistance, REMOTE_SHOT_VISUAL_DISTANCE);
  const occludedAt = request.local && context.playerOcclusion
    ? context.playerOcclusion(request.origin, forward, worldImpact?.distance ?? maxDistance)
    : null;
  const stoppedByPlayer = occludedAt !== null
    && Number.isFinite(occludedAt)
    && occludedAt >= 0
    && (!worldImpact || occludedAt < worldImpact.distance);
  const to = useResolvedEndpoint
    ? resolvedEndpoint
    : stoppedByPlayer
      ? request.origin.clone().addScaledVector(forward, occludedAt)
      : worldImpact?.point
        ?? request.origin.clone().addScaledVector(forward, unresolvedVisualDistance);
  const confirmedPlayerHit = useResolvedEndpoint
    && (request.result === 'hit' || request.result === 'kill');
  const onWorld = worldImpact !== null
    && !stoppedByPlayer
    && !confirmedPlayerHit
    && to.distanceTo(worldImpact.point) <= SAME_SURFACE_M;
  const impactKind = confirmedPlayerHit
    ? (request.playerImpact === false ? undefined : 'player' as const)
    : onWorld ? 'world' as const : undefined;
  const muzzle = computeWorldMuzzlePosition(
    request.weaponId,
    request.origin,
    forward,
    request.cameraUp,
  );
  if (!muzzle) {
    return false;
  }

  const resolvedNormal =
    request.resolvedImpactNormal && isFiniteVector(request.resolvedImpactNormal)
      && request.resolvedImpactNormal.lengthSq() > 1e-8
      ? request.resolvedImpactNormal.clone().normalize()
      : forward.clone().negate();
  context.effects.spawnShot({
    weaponId: request.weaponId,
    from: muzzle,
    to,
    nowMs: request.nowMs,
    impactNormal: useResolvedEndpoint
      ? resolvedNormal
      : stoppedByPlayer ? undefined : worldImpact?.normal,
    impactKind,
    remote: !request.local,
    fatal: request.fatal === true,
  });
  return true;
}

/**
 * Blood for hits whose tracer was not drawn from a server endpoint: our own
 * gun hits (the local tracer was drawn at fire time) and every knife hit.
 * Never on the local victim.
 */
function presentConfirmedHit(context: RemoteShotHandlerContext, event: ShotEvent): void {
  if (
    !context.effects?.spawnBlood
    || (event.result !== 'hit' && event.result !== 'kill')
    || event.targetId === context.getLocalPlayerId()
    || !isFiniteTuple(event.endpoint)
    || !isFiniteTuple(event.dir)
  ) {
    return;
  }
  context.effects.spawnBlood(new Vector3(...event.endpoint), new Vector3(...event.dir), context.nowMs());
}

/**
 * Client-facing transport listener. Both dedicated-server bot ids (`bot:*`) and
 * ordinary peer ids are remote; only the transport's exact local id is filtered
 * from tracer presentation. Our own confirmed hits and all knife hits still get
 * a blood puff at the server's endpoint.
 */
export function createRemoteShotHandler(
  context: RemoteShotHandlerContext,
): (event: ShotEvent) => void {
  return (event) => {
    if (!event || typeof event.playerId !== 'string') {
      return;
    }
    const localId = context.getLocalPlayerId();
    if (event.playerId === localId || event.weaponId === 'knife') {
      presentConfirmedHit(context, event);
      return;
    }
    if (
      (event.weaponId !== 'deagle' && event.weaponId !== 'awp')
      || !isFiniteTuple(event.origin)
      || !isFiniteTuple(event.dir)
    ) {
      return;
    }

    presentFirearmShot(context, {
      weaponId: event.weaponId,
      origin: new Vector3(...event.origin),
      direction: new Vector3(...event.dir),
      nowMs: context.nowMs(),
      local: false,
      resolvedEndpoint: event.endpoint && isFiniteTuple(event.endpoint)
        ? new Vector3(...event.endpoint)
        : undefined,
      resolvedImpactNormal: event.impactNormal && isFiniteTuple(event.impactNormal)
        ? new Vector3(...event.impactNormal)
        : undefined,
      fatal: event.result === 'kill',
      result: event.result,
      playerImpact: event.targetId === undefined || event.targetId !== localId,
    });
  };
}

function validResolvedEndpoint(
  origin: Vector3,
  forward: Vector3,
  maxDistance: number,
  endpoint?: Vector3,
): Vector3 | null {
  if (!endpoint || !isFiniteVector(endpoint)) {
    return null;
  }
  const delta = endpoint.clone().sub(origin);
  const alongRay = delta.dot(forward);
  const lateralDistanceSq = delta.addScaledVector(forward, -alongRay).lengthSq();
  if (alongRay <= 0 || alongRay > maxDistance + 0.05 || lateralDistanceSq > 0.05 ** 2) {
    return null;
  }
  return endpoint;
}

function isFiniteTuple(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value)
    && value.length === 3
    && value.every((component) => typeof component === 'number' && Number.isFinite(component))
  );
}

function isFiniteVector(value: Vector3): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}
