import {
  AddEquation,
  CustomBlending,
  HalfFloatType,
  LinearFilter,
  NoBlending,
  OneFactor,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  type Texture,
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

// 13 tap downsample from jimenez 2014 (call of duty: advanced warfare). the
// first level runs a soft threshold and a karis average so single bright
// pixels (sun glints, sparks) don't flicker.
const DOWNSAMPLE = /* glsl */ `
uniform sampler2D tInput;
uniform vec2 texel;
uniform float threshold;
uniform float knee;
uniform float firstPass;
varying vec2 vUv;

vec3 prefilter(vec3 c) {
  float bright = max(c.r, max(c.g, c.b));
  float soft = clamp(bright - threshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-4);
  float contribution = max(soft, bright - threshold) / max(bright, 1e-4);
  return c * contribution;
}

float karis(vec3 c) {
  return 1.0 / (1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722)));
}

void main() {
  vec3 a = texture2D(tInput, vUv + texel * vec2(-2.0, 2.0)).rgb;
  vec3 b = texture2D(tInput, vUv + texel * vec2(0.0, 2.0)).rgb;
  vec3 c = texture2D(tInput, vUv + texel * vec2(2.0, 2.0)).rgb;
  vec3 d = texture2D(tInput, vUv + texel * vec2(-2.0, 0.0)).rgb;
  vec3 e = texture2D(tInput, vUv).rgb;
  vec3 f = texture2D(tInput, vUv + texel * vec2(2.0, 0.0)).rgb;
  vec3 g = texture2D(tInput, vUv + texel * vec2(-2.0, -2.0)).rgb;
  vec3 h = texture2D(tInput, vUv + texel * vec2(0.0, -2.0)).rgb;
  vec3 i = texture2D(tInput, vUv + texel * vec2(2.0, -2.0)).rgb;
  vec3 j = texture2D(tInput, vUv + texel * vec2(-1.0, 1.0)).rgb;
  vec3 k = texture2D(tInput, vUv + texel * vec2(1.0, 1.0)).rgb;
  vec3 l = texture2D(tInput, vUv + texel * vec2(-1.0, -1.0)).rgb;
  vec3 m = texture2D(tInput, vUv + texel * vec2(1.0, -1.0)).rgb;
  vec3 result;
  if (firstPass > 0.5) {
    vec3 g0 = prefilter((a + b + d + e) * 0.25);
    vec3 g1 = prefilter((b + c + e + f) * 0.25);
    vec3 g2 = prefilter((d + e + g + h) * 0.25);
    vec3 g3 = prefilter((e + f + h + i) * 0.25);
    vec3 g4 = prefilter((j + k + l + m) * 0.25);
    float w0 = karis(g0) * 0.125;
    float w1 = karis(g1) * 0.125;
    float w2 = karis(g2) * 0.125;
    float w3 = karis(g3) * 0.125;
    float w4 = karis(g4) * 0.5;
    result = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / max(w0 + w1 + w2 + w3 + w4, 1e-4);
  } else {
    result = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  // half floats top out at 65504, keep a margin so the blur never makes infs
  gl_FragColor = vec4(min(result, vec3(6e4)), 1.0);
}
`;

// 3x3 tent upsample, added onto the next bigger level
const UPSAMPLE = /* glsl */ `
uniform sampler2D tInput;
uniform vec2 texel;
uniform float radius;
varying vec2 vUv;
void main() {
  vec2 o = texel * radius;
  vec3 s = texture2D(tInput, vUv + vec2(-o.x, o.y)).rgb
    + texture2D(tInput, vUv + vec2(0.0, o.y)).rgb * 2.0
    + texture2D(tInput, vUv + vec2(o.x, o.y)).rgb
    + texture2D(tInput, vUv + vec2(-o.x, 0.0)).rgb * 2.0
    + texture2D(tInput, vUv).rgb * 4.0
    + texture2D(tInput, vUv + vec2(o.x, 0.0)).rgb * 2.0
    + texture2D(tInput, vUv + vec2(-o.x, -o.y)).rgb
    + texture2D(tInput, vUv + vec2(0.0, -o.y)).rgb * 2.0
    + texture2D(tInput, vUv + vec2(o.x, -o.y)).rgb;
  gl_FragColor = vec4(s * (1.0 / 16.0), 1.0);
}
`;

/**
 * physically based bloom: a mip chain of downsamples from half resolution,
 * then tent upsamples added back up the chain. the result is a wide soft glow
 * around anything above the threshold (tracers, muzzle flashes, the sun, lava).
 */
export class Bloom {
  private readonly levels: WebGLRenderTarget[] = [];
  private readonly downMaterial: ShaderMaterial;
  private readonly upMaterial: ShaderMaterial;
  private readonly quad: FullScreenQuad;
  private width = 0;
  private height = 0;

  constructor(private readonly levelCount = 6) {
    this.downMaterial = new ShaderMaterial({
      name: 'BloomDownsample',
      vertexShader: VERTEX,
      fragmentShader: DOWNSAMPLE,
      uniforms: {
        tInput: { value: null },
        texel: { value: new Vector2() },
        threshold: { value: 1 },
        knee: { value: 0.5 },
        firstPass: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
      blending: NoBlending,
    });
    this.upMaterial = new ShaderMaterial({
      name: 'BloomUpsample',
      vertexShader: VERTEX,
      fragmentShader: UPSAMPLE,
      uniforms: {
        tInput: { value: null },
        texel: { value: new Vector2() },
        radius: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: OneFactor,
      blendDst: OneFactor,
    });
    this.quad = new FullScreenQuad(this.downMaterial);
  }

  setSize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    for (const level of this.levels) level.dispose();
    this.levels.length = 0;
    let w = Math.max(1, Math.floor(width / 2));
    let h = Math.max(1, Math.floor(height / 2));
    for (let i = 0; i < this.levelCount; i += 1) {
      const target = new WebGLRenderTarget(w, h, {
        type: HalfFloatType,
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        depthBuffer: false,
      });
      target.texture.name = `BloomMip${i}`;
      target.texture.generateMipmaps = false;
      this.levels.push(target);
      if (w <= 8 || h <= 8) break;
      w = Math.max(1, Math.floor(w / 2));
      h = Math.max(1, Math.floor(h / 2));
    }
  }

  getLevelCount(): number {
    return Math.max(1, this.levels.length);
  }

  /** returns the half resolution bloom texture for the composite */
  render(renderer: WebGLRenderer, input: Texture, threshold: number): Texture {
    const down = this.downMaterial.uniforms;
    this.quad.material = this.downMaterial;
    let source = input;
    let sourceW = this.width;
    let sourceH = this.height;
    for (let i = 0; i < this.levels.length; i += 1) {
      const target = this.levels[i];
      down.tInput.value = source;
      (down.texel.value as Vector2).set(1 / sourceW, 1 / sourceH);
      down.threshold.value = threshold;
      down.knee.value = Math.max(0.05, threshold * 0.5);
      down.firstPass.value = i === 0 ? 1 : 0;
      renderer.setRenderTarget(target);
      this.quad.render(renderer);
      source = target.texture;
      sourceW = target.width;
      sourceH = target.height;
    }
    const up = this.upMaterial.uniforms;
    this.quad.material = this.upMaterial;
    for (let i = this.levels.length - 1; i > 0; i -= 1) {
      const small = this.levels[i];
      up.tInput.value = small.texture;
      (up.texel.value as Vector2).set(1 / small.width, 1 / small.height);
      up.radius.value = 1;
      renderer.setRenderTarget(this.levels[i - 1]);
      this.quad.render(renderer);
    }
    return this.levels[0].texture;
  }

  dispose(): void {
    for (const level of this.levels) level.dispose();
    this.levels.length = 0;
    this.downMaterial.dispose();
    this.upMaterial.dispose();
    this.quad.dispose();
  }
}
