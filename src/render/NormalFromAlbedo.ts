import {
  LinearFilter,
  LinearMipmapLinearFilter,
  NoBlending,
  RepeatWrapping,
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

// height = luminance of the albedo minus a wide blur of it (so big colour
// patches don't tilt whole faces), then sobel into a tangent space normal
const FRAGMENT = /* glsl */ `
uniform sampler2D tAlbedo;
uniform vec2 texel;
uniform float strength;
varying vec2 vUv;

float h(vec2 uv) {
  vec3 c = texture2D(tAlbedo, uv).rgb;
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

float detail(vec2 uv) {
  float c = h(uv);
  float wide = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785398;
    wide += h(uv + vec2(cos(a), sin(a)) * texel * 6.0);
  }
  return c - wide * 0.125;
}

void main() {
  float tl = detail(vUv + texel * vec2(-1.0, 1.0));
  float t = detail(vUv + texel * vec2(0.0, 1.0));
  float tr = detail(vUv + texel * vec2(1.0, 1.0));
  float l = detail(vUv + texel * vec2(-1.0, 0.0));
  float r = detail(vUv + texel * vec2(1.0, 0.0));
  float bl = detail(vUv + texel * vec2(-1.0, -1.0));
  float b = detail(vUv + texel * vec2(0.0, -1.0));
  float br = detail(vUv + texel * vec2(1.0, -1.0));
  float dx = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
  float dy = (tl + 2.0 * t + tr) - (bl + 2.0 * b + br);
  vec3 n = normalize(vec3(-dx * strength, -dy * strength, 1.0));
  gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
}
`;

/**
 * builds tangent space normal maps from albedo textures on the gpu, so the
 * procedural map textures get surface relief without shipping extra files.
 * results are cached per texture and strength.
 */
export class NormalFromAlbedo {
  private readonly material: ShaderMaterial;
  private readonly quad: FullScreenQuad;
  private readonly cache = new Map<string, WebGLRenderTarget>();

  constructor(private readonly renderer: WebGLRenderer) {
    this.material = new ShaderMaterial({
      name: 'NormalFromAlbedo',
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        tAlbedo: { value: null },
        texel: { value: new Vector2() },
        strength: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
      blending: NoBlending,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  get(albedo: Texture, strength: number, maxSize = 1024): Texture | null {
    const image = albedo.image as { width?: number; height?: number } | undefined;
    const width = image?.width ?? 0;
    const height = image?.height ?? 0;
    if (!(width > 0 && height > 0) || !(strength > 0)) return null;
    const size = Math.min(maxSize, Math.max(width, height));
    const key = `${albedo.uuid}:${strength.toFixed(2)}:${size}`;
    const cached = this.cache.get(key);
    if (cached) return cached.texture;
    const target = new WebGLRenderTarget(size, size, {
      minFilter: LinearMipmapLinearFilter,
      magFilter: LinearFilter,
      depthBuffer: false,
      generateMipmaps: true,
    });
    target.texture.wrapS = RepeatWrapping;
    target.texture.wrapT = RepeatWrapping;
    target.texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    target.texture.name = `${albedo.name || 'albedo'}_normal`;
    const u = this.material.uniforms;
    u.tAlbedo.value = albedo;
    (u.texel.value as Vector2).set(1 / width, 1 / height);
    u.strength.value = strength;
    const previous = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(target);
    this.quad.render(this.renderer);
    this.renderer.setRenderTarget(previous);
    this.cache.set(key, target);
    return target.texture;
  }

  clear(): void {
    for (const target of this.cache.values()) target.dispose();
    this.cache.clear();
  }

  dispose(): void {
    this.clear();
    this.material.dispose();
    this.quad.dispose();
  }
}
