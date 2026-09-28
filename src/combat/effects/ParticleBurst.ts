import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  ShaderMaterial,
  Vector3,
  type Texture,
} from 'three';

const VERTEX = /* glsl */ `
attribute vec2 corner;
attribute vec3 aOffset;
attribute vec3 aVelocity;
attribute vec4 aColor;
attribute vec4 aShape;
uniform vec3 origin;
uniform float age;
uniform float gravity;
uniform float drag;
uniform float stretch;
varying vec2 vUv;
varying vec4 vColor;

void main() {
  // aShape: start size, end size, lifetime (s), spin seed
  float life = max(aShape.z, 1e-3);
  float t = min(age, life);
  float travel = drag > 0.0 ? (1.0 - exp(-drag * t)) / drag : t;
  vec3 pos = origin + aOffset + aVelocity * travel;
  pos.y += 0.5 * gravity * t * t;
  float f = clamp(age / life, 0.0, 1.0);
  float size = mix(aShape.x, aShape.y, f);
  vec4 viewPos = viewMatrix * vec4(pos, 1.0);
  vec2 offset;
  if (stretch > 0.0) {
    // sparks: streaks along their current velocity on screen
    vec3 vel = aVelocity * exp(-drag * t) + vec3(0.0, gravity * t, 0.0);
    vec3 viewVel = (viewMatrix * vec4(vel, 0.0)).xyz;
    float speed = length(viewVel.xy);
    vec2 axis = speed > 1e-4 ? viewVel.xy / speed : vec2(1.0, 0.0);
    vec2 perp = vec2(-axis.y, axis.x);
    float len = size + stretch * speed;
    offset = axis * corner.x * len * 0.5 + perp * corner.y * size * 0.5;
  } else {
    float a = aShape.w * 6.2831853 + age * (aShape.w - 0.5) * 1.6;
    float c = cos(a);
    float s = sin(a);
    offset = mat2(c, s, -s, c) * corner * size * 0.5;
  }
  viewPos.xy += offset;
  gl_Position = projectionMatrix * viewPos;
  vUv = corner * 0.5 + 0.5;
  float fade = 1.0 - f;
  // puffs thin out slowly, sparks die fast at the end
  fade = stretch > 0.0 ? fade * fade : fade * (0.6 + 0.4 * fade);
  vColor = vec4(aColor.rgb, aColor.a * fade * step(age, life));
}
`;

const FRAGMENT = /* glsl */ `
uniform sampler2D map;
uniform float useMap;
uniform float stretch;
varying vec2 vUv;
varying vec4 vColor;

void main() {
  float alpha;
  if (useMap > 0.5) {
    alpha = texture2D(map, vUv).a;
  } else {
    vec2 p = vUv * 2.0 - 1.0;
    // streak: hot centre line, round particle: soft disc
    alpha = stretch > 0.0 ? exp(-p.y * p.y * 6.0) * (1.0 - p.x * p.x) : max(0.0, 1.0 - dot(p, p));
  }
  float a = alpha * vColor.a;
  if (a < 0.003) discard;
#ifdef ADDITIVE
  gl_FragColor = vec4(vColor.rgb * a, 1.0);
#else
  gl_FragColor = vec4(vColor.rgb, a);
#endif
}
`;

let quadCorners: Float32Array | null = null;

export interface Particle {
  offset: Vector3;
  velocity: Vector3;
  color: Color;
  opacity: number;
  startSize: number;
  endSize: number;
  lifetime: number;
  seed: number;
}

export interface BurstStyle {
  additive: boolean;
  gravity: number;
  drag: number;
  /** seconds of motion blur along the velocity, 0 = round particles */
  stretch: number;
  map?: Texture | null;
}

/**
 * a burst of particles drawn as one instanced mesh. every position is solved
 * in the vertex shader from the start velocity, drag and gravity, so the cpu
 * only moves one `age` uniform per frame no matter how many particles there are.
 */
export class ParticleBurst extends Mesh<InstancedBufferGeometry, ShaderMaterial> {
  readonly lifetime: number;

  constructor(origin: Vector3, particles: readonly Particle[], style: BurstStyle) {
    const geometry = new InstancedBufferGeometry();
    quadCorners ??= new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]);
    // the quad corners are per vertex, everything else is per particle
    geometry.setAttribute('corner', new Float32BufferAttribute(quadCorners, 2));
    const count = particles.length;
    const offsets = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const colors = new Float32Array(count * 4);
    const shapes = new Float32Array(count * 4);
    let lifetime = 0;
    particles.forEach((p, i) => {
      offsets.set([p.offset.x, p.offset.y, p.offset.z], i * 3);
      velocities.set([p.velocity.x, p.velocity.y, p.velocity.z], i * 3);
      colors.set([p.color.r, p.color.g, p.color.b, p.opacity], i * 4);
      shapes.set([p.startSize, p.endSize, p.lifetime, p.seed], i * 4);
      lifetime = Math.max(lifetime, p.lifetime);
    });
    geometry.setAttribute('aOffset', new InstancedBufferAttribute(offsets, 3));
    geometry.setAttribute('aVelocity', new InstancedBufferAttribute(velocities, 3));
    geometry.setAttribute('aColor', new InstancedBufferAttribute(colors, 4));
    geometry.setAttribute('aShape', new InstancedBufferAttribute(shapes, 4));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.instanceCount = count;
    const material = new ShaderMaterial({
      name: style.additive ? 'ParticleBurstAdditive' : 'ParticleBurst',
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      defines: style.additive ? { ADDITIVE: '' } : {},
      uniforms: {
        origin: { value: origin.clone() },
        age: { value: 0 },
        gravity: { value: style.gravity },
        drag: { value: style.drag },
        stretch: { value: style.stretch },
        map: { value: style.map ?? null },
        useMap: { value: style.map ? 1 : 0 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: style.additive ? AdditiveBlending : NormalBlending,
      // camera facing quads flip winding with their orientation, never cull them
      side: DoubleSide,
      fog: false,
      toneMapped: false,
    });
    super(geometry, material);
    this.lifetime = lifetime;
    this.frustumCulled = false;
    this.renderOrder = 3;
    this.position.copy(origin);
  }

  setAge(seconds: number): void {
    this.material.uniforms.age.value = seconds;
  }

  getAge(): number {
    return this.material.uniforms.age.value as number;
  }

  /** where particle `i` is at the current age, for tests and debugging */
  particlePosition(i: number, out = new Vector3()): Vector3 {
    const g = this.geometry;
    const u = this.material.uniforms;
    const age = u.age.value as number;
    const shape = g.getAttribute('aShape') as InstancedBufferAttribute;
    const t = Math.min(age, shape.getZ(i));
    const drag = u.drag.value as number;
    const travel = drag > 0 ? (1 - Math.exp(-drag * t)) / drag : t;
    const off = g.getAttribute('aOffset') as InstancedBufferAttribute;
    const vel = g.getAttribute('aVelocity') as InstancedBufferAttribute;
    out.set(
      off.getX(i) + vel.getX(i) * travel,
      off.getY(i) + vel.getY(i) * travel + 0.5 * (u.gravity.value as number) * t * t,
      off.getZ(i) + vel.getZ(i) * travel,
    );
    return out.add(u.origin.value as Vector3);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
