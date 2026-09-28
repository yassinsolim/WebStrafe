import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three';

// the streak is drawn as one screen space capsule: the two ends are projected
// in the vertex shader, the quad around them is built in pixels, and the
// fragment shader measures its distance to the projected segment. a round
// flying straight away from the eye then stays a clean line instead of piling
// up many overlapping segments at the vanishing end.
const VERTEX = /* glsl */ `
attribute vec2 corner;
uniform vec3 tailPos;
uniform vec3 headPos;
uniform float width;
uniform float minPixels;
uniform vec2 resolution;
varying vec2 vTailPx;
varying vec2 vHeadPx;
varying vec2 vHalfWidth;

float halfPixels(vec4 clip) {
  // projected world width in pixels, never thinner than minPixels
  return 0.5 * max(minPixels, width * projectionMatrix[1][1] * resolution.y * 0.5 / max(clip.w, 1e-3));
}

void main() {
  vec4 tailView = viewMatrix * vec4(tailPos, 1.0);
  vec4 headView = viewMatrix * vec4(headPos, 1.0);
  // keep both ends in front of the camera so a round flying past the eye
  // still projects to a sane streak instead of wrapping through infinity
  float nearZ = -0.06;
  if (tailView.z > nearZ && headView.z <= nearZ) {
    tailView = mix(headView, tailView, (nearZ - headView.z) / (tailView.z - headView.z));
  } else if (headView.z > nearZ && tailView.z <= nearZ) {
    headView = mix(tailView, headView, (nearZ - tailView.z) / (headView.z - tailView.z));
  }
  vec4 tailClip = projectionMatrix * tailView;
  vec4 headClip = projectionMatrix * headView;
  vec2 tailPx = (tailClip.xy / tailClip.w * 0.5 + 0.5) * resolution;
  vec2 headPx = (headClip.xy / headClip.w * 0.5 + 0.5) * resolution;
  float tailHalf = halfPixels(tailClip);
  float headHalf = halfPixels(headClip);
  vec2 d = headPx - tailPx;
  float len = length(d);
  vec2 dir = len > 1e-3 ? d / len : vec2(1.0, 0.0);
  vec2 perp = vec2(-dir.y, dir.x);
  float halfWidth = mix(tailHalf, headHalf, corner.x);
  vec2 px = mix(tailPx, headPx, corner.x)
    + perp * corner.y * (halfWidth + 1.0)
    + dir * (corner.x * 2.0 - 1.0) * (halfWidth + 1.0);
  // w = 1 so every varying interpolates linearly in screen space; z/w of a 3d
  // segment is linear along its projection, so depth testing still holds
  float z = corner.x < 0.5 ? tailClip.z / tailClip.w : headClip.z / headClip.w;
  gl_Position = vec4(px / resolution * 2.0 - 1.0, z, 1.0);
  vTailPx = tailPx;
  vHeadPx = headPx;
  vHalfWidth = vec2(tailHalf, headHalf);
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 coreColor;
uniform vec3 glowColor;
uniform float intensity;
uniform float headBias;
varying vec2 vTailPx;
varying vec2 vHeadPx;
varying vec2 vHalfWidth;

void main() {
  vec2 d = vHeadPx - vTailPx;
  float len = max(length(d), 1e-3);
  vec2 dir = d / len;
  float t = clamp(dot(gl_FragCoord.xy - vTailPx, dir) / len, 0.0, 1.0);
  float halfWidth = mix(vHalfWidth.x, vHalfWidth.y, t);
  float dist = length(gl_FragCoord.xy - (vTailPx + d * t)) / max(halfWidth, 0.5);
  if (dist > 1.6) discard;
  float core = exp(-dist * dist * 4.5);
  float glow = exp(-dist * dist * 1.2) * 0.25;
  // brightest at the head, the tail end still reads
  float along = mix(0.3, 1.0, pow(t, headBias));
  vec3 color = (coreColor * core + glowColor * glow) * along * intensity;
  gl_FragColor = vec4(color, 1.0);
}
`;

let sharedGeometry: BufferGeometry | null = null;

function ribbonGeometry(): BufferGeometry {
  if (sharedGeometry) return sharedGeometry;
  const geometry = new BufferGeometry();
  // corner.x: 0 tail, 1 head; corner.y: -1 / 1 across
  geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(12), 3));
  geometry.setAttribute('corner', new Float32BufferAttribute([0, -1, 0, 1, 1, -1, 1, 1], 2));
  geometry.setIndex([0, 1, 2, 1, 3, 2]);
  return (sharedGeometry = geometry);
}

export interface TracerRibbonOptions {
  /** hdr color of the core, well above 1 so bloom picks it up */
  core: Color;
  glow: Color;
  /** world width of the streak in metres */
  width: number;
  /** on-screen width floor in pixels so far rounds stay visible */
  minPixels: number;
  /** how quickly the tail fades, higher is a shorter bright part */
  headBias?: number;
  resolution: Vector2;
}

/**
 * one streak between two world points: a hot core with a soft glow, brightest
 * at the head. additive, depth tested, drawn in the hdr pass so bloom gives it
 * the glow instead of a fat mesh.
 */
export class TracerRibbon extends Mesh<BufferGeometry, ShaderMaterial> {
  constructor(options: TracerRibbonOptions) {
    const material = new ShaderMaterial({
      name: 'TracerRibbon',
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        tailPos: { value: new Vector3() },
        headPos: { value: new Vector3() },
        width: { value: options.width },
        minPixels: { value: options.minPixels },
        resolution: { value: options.resolution },
        coreColor: { value: options.core.clone() },
        glowColor: { value: options.glow.clone() },
        intensity: { value: 1 },
        headBias: { value: options.headBias ?? 1.6 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: AdditiveBlending,
      // the quad is built in screen space, its winding depends on the direction
      side: DoubleSide,
      fog: false,
      toneMapped: false,
    });
    super(ribbonGeometry(), material);
    this.frustumCulled = false;
    this.renderOrder = 2;
  }

  setSegment(tail: Vector3, head: Vector3): void {
    (this.material.uniforms.tailPos.value as Vector3).copy(tail);
    (this.material.uniforms.headPos.value as Vector3).copy(head);
    // the geometry is shared, so the object position only tracks the head for debugging
    this.position.copy(head);
  }

  setIntensity(value: number): void {
    this.material.uniforms.intensity.value = value;
  }

  getIntensity(): number {
    return this.material.uniforms.intensity.value as number;
  }

  getTail(): Vector3 {
    return this.material.uniforms.tailPos.value as Vector3;
  }

  getHead(): Vector3 {
    return this.material.uniforms.headPos.value as Vector3;
  }

  dispose(): void {
    this.material.dispose();
  }
}
