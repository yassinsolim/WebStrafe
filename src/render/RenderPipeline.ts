import {
  DepthTexture,
  HalfFloatType,
  LinearFilter,
  NoBlending,
  ShaderMaterial,
  UnsignedIntType,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type Camera,
  type PerspectiveCamera,
  type Scene,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { Bloom } from './Bloom';
import { DEFAULT_GRADE, GRADE_GLSL, whiteBalanceGains, type ColorGrade } from './grade';
import { QUALITY_PRESETS, type QualityPreset } from './quality';
import { Ssao } from './Ssao';

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const COMPOSITE_FRAGMENT = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform sampler2D tAo;
uniform sampler2D tDepth;
uniform float aoOverlay;
uniform float bloomStrength;
uniform float vignette;
uniform vec2 resolution;
uniform float fxaa;
varying vec2 vUv;
${GRADE_GLSL}

vec3 graded(vec2 uv) {
  vec3 c = texture2D(tScene, uv).rgb;
#ifdef USE_AO
  // after the viewmodel pass the depth buffer only holds the gun and arms
  // (it was cleared to far), so anything nearer than far keeps its own light
  float isOverlay = aoOverlay > 0.5 && texture2D(tDepth, uv).x < 0.99999 ? 1.0 : 0.0;
  c *= mix(texture2D(tAo, uv).r, 1.0, isOverlay);
#endif
#ifdef USE_BLOOM
  // the chain sums every mip, strength already folds in 1 / mip count
  c += texture2D(tBloom, uv).rgb * bloomStrength;
#endif
  return gradeColor(c);
}

float luma(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}

// fxaa 2 style edge blend on the graded color, only on the low preset
vec3 antialiased(vec2 uv) {
  vec2 px = 1.0 / resolution;
  vec3 rgbM = graded(uv);
  vec3 rgbNW = graded(uv + vec2(-1.0, -1.0) * px);
  vec3 rgbNE = graded(uv + vec2(1.0, -1.0) * px);
  vec3 rgbSW = graded(uv + vec2(-1.0, 1.0) * px);
  vec3 rgbSE = graded(uv + vec2(1.0, 1.0) * px);
  float lM = luma(rgbM);
  float lNW = luma(rgbNW);
  float lNE = luma(rgbNE);
  float lSW = luma(rgbSW);
  float lSE = luma(rgbSE);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  if (lMax - lMin < max(0.0312, lMax * 0.125)) return rgbM;
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
  float reduce = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
  float rcpMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
  dir = clamp(dir * rcpMin, vec2(-8.0), vec2(8.0)) * px;
  vec3 a = 0.5 * (graded(uv + dir * (1.0 / 3.0 - 0.5)) + graded(uv + dir * (2.0 / 3.0 - 0.5)));
  vec3 b = a * 0.5 + 0.25 * (graded(uv - dir * 0.5) + graded(uv + dir * 0.5));
  float lB = luma(b);
  return (lB < lMin || lB > lMax) ? a : b;
}

vec3 toSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}

void main() {
  vec3 color = fxaa > 0.5 ? antialiased(vUv) : graded(vUv);
  vec2 v = vUv - 0.5;
  color *= 1.0 - vignette * smoothstep(0.18, 0.9, dot(v, v) * 2.2);
  color = toSrgb(clamp(color, 0.0, 1.0));
  // blue-ish noise dither so dark gradients (sky, fog) don't band
  float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  color += (n - 0.5) / 255.0;
  gl_FragColor = vec4(color, 1.0);
}
`;

export interface PipelineStats {
  msaa: number;
  bloom: boolean;
  ao: boolean;
  fxaa: boolean;
  width: number;
  height: number;
}

/**
 * hdr frame: world into a half float target (msaa on medium and high), ssao
 * multiplied into the world only, then the viewmodel on top after a depth
 * clear, bloom, and one composite pass that grades, tone maps, vignettes,
 * antialiases (low preset) and dithers straight to the canvas.
 */
export class RenderPipeline {
  private sceneTarget: WebGLRenderTarget | null = null;
  private readonly bloom = new Bloom();
  private readonly ssao = new Ssao();
  private readonly composite: ShaderMaterial;
  private readonly quad: FullScreenQuad;
  private preset: QualityPreset = QUALITY_PRESETS.high;
  private grade: ColorGrade = { ...DEFAULT_GRADE };
  private width = 1;
  private height = 1;
  private readonly wb = new Vector3();

  constructor(private readonly renderer: WebGLRenderer) {
    this.composite = new ShaderMaterial({
      name: 'FrameComposite',
      vertexShader: VERTEX,
      fragmentShader: COMPOSITE_FRAGMENT,
      uniforms: {
        tScene: { value: null },
        tBloom: { value: null },
        tAo: { value: null },
        tDepth: { value: null },
        aoOverlay: { value: 0 },
        bloomStrength: { value: 0 },
        vignette: { value: 0 },
        resolution: { value: new Vector2(1, 1) },
        fxaa: { value: 0 },
        gradeExposure: { value: 1 },
        gradeWhiteBalance: { value: new Vector3(1, 1, 1) },
        gradeContrast: { value: 1 },
        gradeSaturation: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
      blending: NoBlending,
      toneMapped: false,
    });
    this.quad = new FullScreenQuad(this.composite);
  }

  getPreset(): QualityPreset {
    return this.preset;
  }

  getGrade(): ColorGrade {
    return this.grade;
  }

  setPreset(preset: QualityPreset): void {
    const rebuild = !this.sceneTarget || preset.msaa !== this.preset.msaa || preset.ao !== this.preset.ao;
    this.preset = preset;
    if (preset.bloom) this.bloom.setLevelCount(preset.bloomLevels);
    if (preset.bloom) this.composite.defines.USE_BLOOM = '';
    else delete this.composite.defines.USE_BLOOM;
    if (preset.ao) this.composite.defines.USE_AO = '';
    else delete this.composite.defines.USE_AO;
    this.composite.needsUpdate = true;
    if (rebuild) this.rebuildTarget();
  }

  setGrade(grade: ColorGrade): void {
    this.grade = { ...grade };
  }

  /** drawing buffer size in pixels */
  setSize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    if (w === this.width && h === this.height && this.sceneTarget) return;
    this.width = w;
    this.height = h;
    this.sceneTarget?.setSize(w, h);
    this.bloom.setSize(w, h);
    this.ssao.setSize(w, h);
    (this.composite.uniforms.resolution.value as Vector2).set(w, h);
    if (!this.sceneTarget) this.rebuildTarget();
  }

  getStats(): PipelineStats {
    return {
      msaa: this.sceneTarget?.samples ?? 0,
      bloom: this.preset.bloom,
      ao: this.preset.ao,
      fxaa: this.preset.fxaa,
      width: this.width,
      height: this.height,
    };
  }

  render(world: Scene, worldCamera: PerspectiveCamera, overlay: Scene | null, overlayCamera: Camera | null): void {
    const renderer = this.renderer;
    const target = this.sceneTarget;
    if (!target) return;
    renderer.setRenderTarget(target);
    renderer.clear(true, true, false);
    renderer.render(world, worldCamera);
    let ao: Texture | null = null;
    if (this.preset.ao && target.depthTexture) {
      ao = this.ssao.compute(renderer, target.depthTexture, worldCamera, this.width, this.height);
    }
    if (overlay && overlayCamera) {
      renderer.setRenderTarget(target);
      renderer.clearDepth();
      renderer.render(overlay, overlayCamera);
    }
    let bloom: Texture | null = null;
    if (this.preset.bloom && this.grade.bloom > 0) {
      bloom = this.bloom.render(renderer, target.texture, this.grade.bloomThreshold / Math.max(0.05, this.grade.exposure));
    }
    const u = this.composite.uniforms;
    u.tScene.value = target.texture;
    u.tBloom.value = bloom;
    u.tAo.value = ao;
    u.tDepth.value = target.depthTexture;
    u.aoOverlay.value = overlay && overlayCamera ? 1 : 0;
    u.bloomStrength.value = bloom ? this.grade.bloom / this.bloom.getLevelCount() : 0;
    u.vignette.value = this.grade.vignette;
    u.fxaa.value = this.preset.fxaa ? 1 : 0;
    u.gradeExposure.value = this.grade.exposure;
    u.gradeWhiteBalance.value = whiteBalanceGains(this.grade.temperature, this.grade.tint, this.wb);
    u.gradeContrast.value = this.grade.contrast;
    u.gradeSaturation.value = this.grade.saturation;
    renderer.setRenderTarget(null);
    this.quad.render(renderer);
  }

  dispose(): void {
    this.sceneTarget?.dispose();
    this.sceneTarget?.depthTexture?.dispose();
    this.sceneTarget = null;
    this.bloom.dispose();
    this.ssao.dispose();
    this.composite.dispose();
    this.quad.dispose();
  }

  private rebuildTarget(): void {
    const old = this.sceneTarget;
    old?.depthTexture?.dispose();
    old?.dispose();
    // three wants null here, undefined throws inside the depthTexture setter
    const depthTexture = this.preset.ao ? new DepthTexture(this.width, this.height, UnsignedIntType) : null;
    this.sceneTarget = new WebGLRenderTarget(this.width, this.height, {
      type: HalfFloatType,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
      samples: this.preset.msaa,
      depthTexture,
    });
    this.sceneTarget.texture.name = 'SceneHdr';
    this.sceneTarget.texture.generateMipmaps = false;
  }
}
