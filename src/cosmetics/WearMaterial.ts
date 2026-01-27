import { Color, MeshStandardMaterial } from 'three';

export interface WearParams {
  wear: number;
  patternSeed: number;
  patternScale: number;
  hueShift: number;
}

export function applyWearShader(baseMaterial: MeshStandardMaterial, params: WearParams): MeshStandardMaterial {
  const material = baseMaterial.clone();
  material.userData.wearParams = { ...params };

  material.onBeforeCompile = (shader) => {
    shader.uniforms.wear = { value: params.wear };
    shader.uniforms.patternSeed = { value: params.patternSeed };
    shader.uniforms.patternScale = { value: params.patternScale };
    shader.uniforms.hueShift = { value: params.hueShift };

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `
#include <common>
uniform float wear;
uniform float patternSeed;
uniform float patternScale;
uniform float hueShift;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345 + patternSeed);
  return fract(p.x * p.y);
}

vec3 shiftHue(vec3 color, float amount) {
  const mat3 toYIQ = mat3(
    0.299, 0.595716, 0.211456,
    0.587, -0.274453, -0.522591,
    0.114, -0.321263, 0.311135
  );
  const mat3 toRGB = mat3(
    1.0, 1.0, 1.0,
    0.9563, -0.2721, -1.1070,
    0.6210, -0.6474, 1.7046
  );

  vec3 yiq = color * toYIQ;
  float hue = atan(yiq.z, yiq.y) + amount;
  float chroma = sqrt(yiq.y * yiq.y + yiq.z * yiq.z);
  vec3 shifted = vec3(yiq.x, chroma * cos(hue), chroma * sin(hue));
  return clamp(shifted * toRGB, 0.0, 1.0);
}
`,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `
#include <map_fragment>
float wearMask = 0.0;
{
  vec2 patternUv = vMapUv * max(patternScale, 0.001);
  float n = hash21(patternUv + vec2(patternSeed * 0.13, patternSeed * 0.77));
  float edge = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 1.8);
  wearMask = clamp((edge * 0.9 + n * 0.35) * wear, 0.0, 1.0);
  float luma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  vec3 desat = mix(diffuseColor.rgb, vec3(luma), 0.6 * wearMask);
  diffuseColor.rgb = shiftHue(desat, hueShift);
}
`,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      'float roughnessFactor = roughness;',
      `
float roughnessFactor = roughness;
roughnessFactor = min(1.0, roughnessFactor + wearMask * 0.45);
`,
    );

    material.userData.wearShader = shader;
  };

  material.needsUpdate = true;
  return material;
}

export function tintColor(hexColor: string): Color {
  const color = new Color();
  color.set(hexColor);
  return color;
}
