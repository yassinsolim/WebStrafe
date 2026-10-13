import { Matrix4, Quaternion, Vector3 } from 'three';
import { smoothstep, springStep, type SpringState } from './motion';

const tmpDir = new Vector3();
const tmpPole = new Vector3();
const tmpX = new Vector3();
const tmpY = new Vector3();
const tmpZ = new Vector3();
const tmpM = new Matrix4();
const wristPole = new Vector3();
const wristTurn = new Quaternion();
const wristInverse = new Quaternion();
const wristDirection = new Vector3();
const wristLimited = new Vector3();
// a wrist asked to bend past 70 degrees is read as a 70 degree bend the same way, easing back to straight as it folds right back
const FOLD_SLOPE = Math.tan(20 * Math.PI / 180);
const FOLD_EASE = 0.35;
// the last 30% of a wrist limit slows the hand into it instead of stopping it dead (a fast swing would jolt)
const LIMIT_KNEE = 0.3;
// the elbow's wrist fix fades in over this many radians past the comfortable bend
const POLE_KNEE = 0.12;

function softLimit(x: number, lo: number, hi: number): number {
  const kneeHi = hi * LIMIT_KNEE;
  const kneeLo = -lo * LIMIT_KNEE;
  if (x > hi - kneeHi) return hi - kneeHi + kneeHi * Math.tanh((x - hi + kneeHi) / kneeHi);
  if (x < lo + kneeLo) return lo + kneeLo - kneeLo * Math.tanh((lo + kneeLo - x) / kneeLo);
  return x;
}

/** max(0, d) with the corner rounded off over +-knee */
function softExcess(d: number, knee: number): number {
  if (d <= -knee) return 0;
  if (d >= knee) return d;
  return (d + knee) ** 2 / (4 * knee);
}

/**
 * per arm: which way the elbow points round the shoulder to wrist line follows
 * the solved way on a spring, because the solved way can swing half a turn in
 * a frame (an elbow hint passing over the arm line, the hand pointing along
 * it). `dt` is the time since the last solve; `snap` takes the solved way at
 * once (scrubbing, a reappearing arm)
 */
export interface SwivelFilter {
  dir: Vector3;
  v: number;
  dt: number;
  snap: boolean;
}

export function createSwivelFilter(): SwivelFilter {
  return { dir: new Vector3(), v: 0, dt: 0, snap: true };
}

const SWIVEL_HALFLIFE = 0.035;
const swivelShown = new Vector3();
const swivelState: SpringState = { x: 0, v: 0 };

/** turns tmpPole (unit, square to tmpDir) to where the filter shows the elbow */
function filterSwivel(filter: SwivelFilter | undefined): void {
  if (!filter) return;
  swivelShown.copy(filter.dir).addScaledVector(tmpDir, -filter.dir.dot(tmpDir));
  if (filter.snap || swivelShown.lengthSq() < 1e-8) {
    filter.v = 0;
    filter.snap = false;
  } else {
    // last frame's elbow carried onto this frame's arm line, then sprung toward the solved one
    swivelShown.normalize();
    swivelState.x = signedAngleAbout(tmpPole, swivelShown, tmpDir);
    swivelState.v = filter.v;
    if (filter.dt > 0) springStep(swivelState, 0, SWIVEL_HALFLIFE, filter.dt);
    filter.v = swivelState.v;
    tmpPole.applyQuaternion(wristTurn.setFromAxisAngle(tmpDir, swivelState.x));
  }
  filter.dir.copy(tmpPole);
}

/**
 * analytic two bone ik. writes the elbow position into `outElbow` and the
 * reachable wrist position into `outWrist` (the target pulled in when it's out
 * of reach). the elbow bends toward `pole`. returns true when the target was
 * reachable without clamping.
 */
export function solveTwoBone(
  root: Vector3,
  target: Vector3,
  pole: Vector3,
  lenA: number,
  lenB: number,
  outElbow: Vector3,
  outWrist: Vector3,
  handDirection?: Vector3,
  preferredWristBendDeg = 35,
  swivel?: SwivelFilter,
): boolean {
  tmpDir.subVectors(target, root);
  const rawDist = tmpDir.length();
  if (rawDist < 1e-6) {
    tmpDir.set(0, 0, -1);
  } else {
    tmpDir.divideScalar(rawDist);
  }
  const minDist = Math.abs(lenA - lenB) + 1e-4;
  const maxDist = lenA + lenB - 1e-5;
  const dist = Math.min(maxDist, Math.max(minDist, rawDist));

  // pole direction, perpendicular to root -> target
  tmpPole.subVectors(pole, root);
  tmpPole.addScaledVector(tmpDir, -tmpPole.dot(tmpDir));
  if (tmpPole.lengthSq() < 1e-10) {
    tmpPole.set(0, -1, 0).addScaledVector(tmpDir, -tmpDir.y);
    if (tmpPole.lengthSq() < 1e-10) {
      tmpPole.set(1, 0, 0);
    }
  }
  tmpPole.normalize();

  const cosA = Math.min(1, Math.max(-1, (lenA * lenA + dist * dist - lenB * lenB) / (2 * lenA * dist)));
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  if (handDirection) {
    wristPole.copy(handDirection).addScaledVector(tmpDir, -handDirection.dot(tmpDir)).negate();
    const lateral = wristPole.length();
    const reach = lenA * sinA * lateral / lenB;
    if (reach > 1e-6) {
      wristPole.divideScalar(lateral);
      const along = (dist - lenA * cosA) * handDirection.dot(tmpDir) / lenB;
      const allowed = Math.acos(Math.min(1, Math.max(-1, (Math.cos(preferredWristBendDeg * Math.PI / 180) - along) / reach)));
      const turn = signedAngleAbout(tmpPole, wristPole, tmpDir);
      // straight across either way round is as good, so aim right at it there instead of flipping sides
      const keep = allowed * smoothstep(Math.PI, 0.75 * Math.PI, Math.abs(turn));
      const excess = softExcess(Math.abs(turn) - keep, POLE_KNEE) * smoothstep(0, 0.15, lateral);
      if (excess !== 0) tmpPole.applyQuaternion(wristTurn.setFromAxisAngle(tmpDir, Math.sign(turn) * excess));
    }
  }
  filterSwivel(swivel);
  outElbow.copy(root).addScaledVector(tmpDir, lenA * cosA).addScaledVector(tmpPole, lenA * sinA);
  outWrist.copy(root).addScaledVector(tmpDir, dist);
  return rawDist <= lenA + lenB && rawDist >= minDist;
}

export function constrainWristRotation(forearmDirection: Vector3, handRotation: Quaternion, out: Quaternion, relaxed = false): Quaternion {
  wristDirection.copy(forearmDirection).normalize().applyQuaternion(wristInverse.copy(handRotation).invert());
  // atan2 against a backwards y wraps from +180 to -180, which flipped the hand from one limit to the other
  const ahead = Math.max(wristDirection.y, Math.hypot(wristDirection.x, wristDirection.z) * FOLD_SLOPE + Math.max(0, -wristDirection.y) * FOLD_EASE, 1e-6);
  const flex = Math.atan2(wristDirection.z, ahead);
  const deviation = Math.atan2(wristDirection.x, ahead);
  const limitedFlex = softLimit(flex, (relaxed ? -20 : -45) * Math.PI / 180, (relaxed ? 20 : 40) * Math.PI / 180);
  const sideways = (relaxed ? 15 : 25) * Math.PI / 180;
  const limitedDeviation = softLimit(deviation, -sideways, sideways);
  if (ahead === wristDirection.y && Math.abs(flex - limitedFlex) < 1e-6 && Math.abs(deviation - limitedDeviation) < 1e-6) return out.copy(handRotation);
  wristLimited.set(Math.tan(limitedDeviation), 1, Math.tan(limitedFlex)).normalize();
  wristTurn.setFromUnitVectors(wristLimited, wristDirection);
  return out.copy(handRotation).multiply(wristTurn).normalize();
}

/**
 * rotation whose local +Y is `yAxis` and local +Z is as close to `zHint` as
 * possible (x = y cross z, right handed like the arm bones).
 */
export function frameFromYZ(yAxis: Vector3, zHint: Vector3, out: Quaternion): Quaternion {
  tmpY.copy(yAxis).normalize();
  tmpZ.copy(zHint).addScaledVector(tmpY, -zHint.dot(tmpY));
  if (tmpZ.lengthSq() < 1e-10) {
    // hint parallel to y, pick anything perpendicular
    tmpZ.set(0, 0, 1).addScaledVector(tmpY, -tmpY.z);
    if (tmpZ.lengthSq() < 1e-10) {
      tmpZ.set(1, 0, 0);
    }
  }
  tmpZ.normalize();
  tmpX.crossVectors(tmpY, tmpZ);
  tmpM.makeBasis(tmpX, tmpY, tmpZ);
  return out.setFromRotationMatrix(tmpM);
}

/** rotation from three orthonormal axis columns */
export function frameFromAxes(x: Vector3, y: Vector3, z: Vector3, out: Quaternion): Quaternion {
  tmpM.makeBasis(x, y, z);
  return out.setFromRotationMatrix(tmpM);
}

const twistRef = new Vector3();
const twistOther = new Vector3();

/**
 * signed angle about `axis` that takes `from` onto `to` once both are
 * projected onto the plane perpendicular to `axis`.
 */
export function signedAngleAbout(from: Vector3, to: Vector3, axis: Vector3): number {
  twistRef.copy(from).addScaledVector(axis, -from.dot(axis));
  twistOther.copy(to).addScaledVector(axis, -to.dot(axis));
  if (twistRef.lengthSq() < 1e-12 || twistOther.lengthSq() < 1e-12) {
    return 0;
  }
  twistRef.normalize();
  twistOther.normalize();
  const cos = Math.min(1, Math.max(-1, twistRef.dot(twistOther)));
  const sign = Math.sign(twistRef.cross(twistOther).dot(axis)) || 1;
  return Math.acos(cos) * sign;
}

/** rotation whose local +X is `xAxis` and local +Z is as close to `zHint` as possible */
export function frameFromXZ(xAxis: Vector3, zHint: Vector3, out: Quaternion): Quaternion {
  tmpX.copy(xAxis).normalize();
  tmpZ.copy(zHint).addScaledVector(tmpX, -zHint.dot(tmpX));
  if (tmpZ.lengthSq() < 1e-10) {
    tmpZ.set(0, 0, 1).addScaledVector(tmpX, -tmpX.z);
  }
  tmpZ.normalize();
  tmpY.crossVectors(tmpZ, tmpX);
  tmpM.makeBasis(tmpX, tmpY, tmpZ);
  return out.setFromRotationMatrix(tmpM);
}
