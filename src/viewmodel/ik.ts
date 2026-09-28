import { Matrix4, Quaternion, Vector3 } from 'three';

const tmpDir = new Vector3();
const tmpPole = new Vector3();
const tmpX = new Vector3();
const tmpY = new Vector3();
const tmpZ = new Vector3();
const tmpM = new Matrix4();

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
  outElbow.copy(root).addScaledVector(tmpDir, lenA * cosA).addScaledVector(tmpPole, lenA * sinA);
  outWrist.copy(root).addScaledVector(tmpDir, dist);
  return rawDist <= lenA + lenB && rawDist >= minDist;
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
