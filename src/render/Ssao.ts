import {
  CustomBlending,
  DstColorFactor,
  LinearFilter,
  Matrix4,
  NoBlending,
  RedFormat,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector4,
  WebGLRenderTarget,
  ZeroFactor,
  type PerspectiveCamera,
  type DepthTexture,
  type WebGLRenderer,
} from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// alchemy ao (mcguire et al. 2011) on a vogel spiral, normals rebuilt from the
// depth buffer, so there is no extra geometry pass. runs at half resolution.
const AO_FRAGMENT = /* glsl */ `
#define SAMPLES 12
uniform sampler2D tDepth;
uniform mat4 invProjection;
uniform vec4 projScale;
uniform vec2 depthTexel;
uniform float radius;
uniform float intensity;
uniform float bias;
uniform float fadeStart;
uniform float fadeEnd;
varying vec2 vUv;

vec3 viewPos(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  vec4 v = invProjection * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return v.xyz / v.w;
}

float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

void main() {
  float depth = texture2D(tDepth, vUv).x;
  if (depth >= 0.99999) {
    gl_FragColor = vec4(1.0);
    return;
  }
  vec3 p = viewPos(vUv);
  vec3 pr = viewPos(vUv + vec2(depthTexel.x, 0.0));
  vec3 pl = viewPos(vUv - vec2(depthTexel.x, 0.0));
  vec3 pu = viewPos(vUv + vec2(0.0, depthTexel.y));
  vec3 pd = viewPos(vUv - vec2(0.0, depthTexel.y));
  vec3 dx = abs(pr.z - p.z) < abs(p.z - pl.z) ? pr - p : p - pl;
  vec3 dy = abs(pu.z - p.z) < abs(p.z - pd.z) ? pu - p : p - pd;
  vec3 n = normalize(cross(dx, dy));

  float dist = -p.z;
  vec2 uvRadius = radius * projScale.xy / dist;
  // tiny screen radius means far away, nothing to gain
  if (uvRadius.y * projScale.w < 1.0) {
    gl_FragColor = vec4(1.0);
    return;
  }
  float spin = ign(gl_FragCoord.xy) * 6.2831853;
  float sum = 0.0;
  float r2 = radius * radius;
  for (int i = 0; i < SAMPLES; i++) {
    float fi = float(i) + 0.5;
    float a = fi * 2.3999632 + spin;
    float l = sqrt(fi / float(SAMPLES));
    vec2 offset = vec2(cos(a), sin(a)) * l * uvRadius;
    vec3 q = viewPos(vUv + offset);
    vec3 v = q - p;
    float vv = dot(v, v);
    float falloff = max(0.0, 1.0 - vv / r2);
    sum += max(0.0, dot(v, n) - bias * dist) / (vv + 0.01) * falloff;
  }
  float ao = max(0.0, 1.0 - 2.0 * intensity * sum / float(SAMPLES));
  ao = mix(ao, 1.0, smoothstep(fadeStart, fadeEnd, dist));
  gl_FragColor = vec4(ao, ao, ao, 1.0);
}
`;

// depth aware 9 tap blur, run once horizontally and once vertically
const BLUR_FRAGMENT = /* glsl */ `
uniform sampler2D tAo;
uniform sampler2D tDepth;
uniform vec2 direction;
uniform float cameraNear;
uniform float cameraFar;
varying vec2 vUv;

float linearDepth(vec2 uv) {
  float d = texture2D(tDepth, uv).x * 2.0 - 1.0;
  return 2.0 * cameraNear * cameraFar / (cameraFar + cameraNear - d * (cameraFar - cameraNear));
}

void main() {
  float center = linearDepth(vUv);
  float total = 0.0;
  float weight = 0.0;
  for (int i = -4; i <= 4; i++) {
    vec2 uv = vUv + direction * float(i);
    float d = linearDepth(uv);
    float w = exp(-float(i * i) * 0.12) * max(0.0, 1.0 - abs(d - center) / (center * 0.05 + 0.02));
    total += texture2D(tAo, uv).r * w;
    weight += w;
  }
  float ao = weight > 1e-4 ? total / weight : texture2D(tAo, vUv).r;
  gl_FragColor = vec4(ao, ao, ao, 1.0);
}
`;

const APPLY_FRAGMENT = /* glsl */ `
uniform sampler2D tAo;
varying vec2 vUv;
void main() {
  float ao = texture2D(tAo, vUv).r;
  gl_FragColor = vec4(ao, ao, ao, 1.0);
}
`;

export interface SsaoOptions {
  radius?: number;
  intensity?: number;
}

/**
 * screen space ao for the world pass. it reads the resolved depth of the scene
 * target and multiplies the result into its color before the viewmodel is
 * drawn, so the gun and arms never get world occlusion.
 */
export class Ssao {
  private readonly aoTarget: WebGLRenderTarget;
  private readonly blurTarget: WebGLRenderTarget;
  private readonly aoMaterial: ShaderMaterial;
  private readonly blurMaterial: ShaderMaterial;
  private readonly applyMaterial: ShaderMaterial;
  private readonly quad = new FullScreenQuad();
  private readonly invProjection = new Matrix4();
  public radius: number;
  public intensity: number;

  constructor(options: SsaoOptions = {}) {
    this.radius = options.radius ?? 0.6;
    this.intensity = options.intensity ?? 0.9;
    const targetOptions = {
      type: UnsignedByteType,
      format: RedFormat,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: false,
    };
    this.aoTarget = new WebGLRenderTarget(1, 1, targetOptions);
    this.blurTarget = new WebGLRenderTarget(1, 1, targetOptions);
    this.aoMaterial = new ShaderMaterial({
      name: 'SsaoAlchemy',
      vertexShader: VERTEX,
      fragmentShader: AO_FRAGMENT,
      uniforms: {
        tDepth: { value: null },
        invProjection: { value: this.invProjection },
        projScale: { value: new Vector4() },
        depthTexel: { value: new Vector2() },
        radius: { value: this.radius },
        intensity: { value: this.intensity },
        bias: { value: 0.012 },
        fadeStart: { value: 40 },
        fadeEnd: { value: 90 },
      },
      depthTest: false,
      depthWrite: false,
      blending: NoBlending,
    });
    this.blurMaterial = new ShaderMaterial({
      name: 'SsaoBlur',
      vertexShader: VERTEX,
      fragmentShader: BLUR_FRAGMENT,
      uniforms: {
        tAo: { value: null },
        tDepth: { value: null },
        direction: { value: new Vector2() },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 1000 },
      },
      depthTest: false,
      depthWrite: false,
      blending: NoBlending,
    });
    this.applyMaterial = new ShaderMaterial({
      name: 'SsaoApply',
      vertexShader: VERTEX,
      fragmentShader: APPLY_FRAGMENT,
      uniforms: { tAo: { value: null } },
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: CustomBlending,
      blendSrc: DstColorFactor,
      blendDst: ZeroFactor,
    });
  }

  setSize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width / 2));
    const h = Math.max(1, Math.floor(height / 2));
    this.aoTarget.setSize(w, h);
    this.blurTarget.setSize(w, h);
  }

  /** computes ao from `depth` and multiplies it into `target`'s color */
  render(renderer: WebGLRenderer, depth: DepthTexture, target: WebGLRenderTarget, camera: PerspectiveCamera): void {
    const w = this.aoTarget.width;
    const h = this.aoTarget.height;
    this.invProjection.copy(camera.projectionMatrixInverse);
    const p = camera.projectionMatrix.elements;
    const ao = this.aoMaterial.uniforms;
    ao.tDepth.value = depth;
    // uv radius per metre at distance 1: 0.5 * projection scale
    (ao.projScale.value as Vector4).set(p[0] * 0.5, p[5] * 0.5, w, h);
    (ao.depthTexel.value as Vector2).set(2 / target.width, 2 / target.height);
    ao.radius.value = this.radius;
    ao.intensity.value = this.intensity;
    this.quad.material = this.aoMaterial;
    renderer.setRenderTarget(this.aoTarget);
    this.quad.render(renderer);

    const blur = this.blurMaterial.uniforms;
    blur.tDepth.value = depth;
    blur.cameraNear.value = camera.near;
    blur.cameraFar.value = camera.far;
    this.quad.material = this.blurMaterial;
    blur.tAo.value = this.aoTarget.texture;
    (blur.direction.value as Vector2).set(1 / w, 0);
    renderer.setRenderTarget(this.blurTarget);
    this.quad.render(renderer);
    blur.tAo.value = this.blurTarget.texture;
    (blur.direction.value as Vector2).set(0, 1 / h);
    renderer.setRenderTarget(this.aoTarget);
    this.quad.render(renderer);

    this.applyMaterial.uniforms.tAo.value = this.aoTarget.texture;
    this.quad.material = this.applyMaterial;
    renderer.setRenderTarget(target);
    this.quad.render(renderer);
  }

  dispose(): void {
    this.aoTarget.dispose();
    this.blurTarget.dispose();
    this.aoMaterial.dispose();
    this.blurMaterial.dispose();
    this.applyMaterial.dispose();
    this.quad.dispose();
  }
}
