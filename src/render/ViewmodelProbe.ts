import {
  CubeCamera,
  HalfFloatType,
  LinearFilter,
  PMREMGenerator,
  Vector3,
  WebGLCubeRenderTarget,
} from 'three';
import type { Camera, Scene, Texture, WebGLRenderer, WebGLRenderTarget } from 'three';

const FACES = 6;
/** a new capture starts once the eye has moved this far */
const MOVE_M = 1;
/** or this long after the last one, for doors, players and the like */
const MAX_AGE_S = 0.5;
/** a jump this big in one frame is a spawn or teleport, capture all faces at once */
const TELEPORT_M = 6;

/**
 * a tiny cube capture of the world around the eye, prefiltered like any
 * environment map. the viewmodel uses it instead of the sky capture, so the gun
 * and arms pick up the floor and walls next to the player: bright bounce off a
 * white floor, warm fill from sand, darker in a corridor. one face renders per
 * frame and the prefilter runs once all six are in, so a refresh costs about a
 * sixth of a small world render per frame.
 */
export class ViewmodelProbe {
  private readonly cube: WebGLCubeRenderTarget;
  private readonly cubeCamera: CubeCamera;
  private readonly pmrem: PMREMGenerator;
  private target: WebGLRenderTarget | null = null;
  private ready = false;
  /** next face to render, -1 between captures */
  private face = -1;
  private readonly capturedAt = new Vector3(Infinity, Infinity, Infinity);
  private readonly lastEye = new Vector3(Infinity, Infinity, Infinity);
  private sinceS = Infinity;

  constructor(private readonly renderer: WebGLRenderer, size = 32) {
    this.cube = new WebGLCubeRenderTarget(size, {
      type: HalfFloatType,
      generateMipmaps: false,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
    });
    this.cubeCamera = new CubeCamera(0.05, 500, this.cube);
    this.pmrem = new PMREMGenerator(renderer);
  }

  /** the prefiltered capture, null until the first one finishes */
  public getTexture(): Texture | null {
    return this.ready && this.target ? this.target.texture : null;
  }

  /** forget the old capture (new map), the next update captures from scratch */
  public reset(): void {
    this.ready = false;
    this.face = -1;
    this.sinceS = Infinity;
    this.capturedAt.set(Infinity, Infinity, Infinity);
    this.lastEye.set(Infinity, Infinity, Infinity);
  }

  public update(scene: Scene, eye: Vector3, dt: number): void {
    this.sinceS += dt;
    const jumped = eye.distanceToSquared(this.lastEye) > TELEPORT_M * TELEPORT_M;
    this.lastEye.copy(eye);
    const immediate = !this.ready || jumped;
    if (this.face < 0 || immediate) {
      const moved = eye.distanceToSquared(this.capturedAt) > MOVE_M * MOVE_M;
      if (!immediate && !moved && this.sinceS < MAX_AGE_S) return;
      this.face = 0;
      this.sinceS = 0;
      this.capturedAt.copy(eye);
      this.cubeCamera.position.copy(eye);
      this.cubeCamera.updateMatrixWorld(true);
    }
    const end = immediate ? FACES : this.face + 1;
    this.renderFaces(scene, this.face, end);
    this.face = end;
    if (this.face < FACES) return;
    this.face = -1;
    this.target = this.pmrem.fromCubemap(this.cube.texture, this.target);
    this.ready = true;
  }

  public dispose(): void {
    this.cube.dispose();
    this.target?.dispose();
    this.target = null;
    this.pmrem.dispose();
    this.ready = false;
  }

  private renderFaces(scene: Scene, from: number, to: number): void {
    const renderer = this.renderer;
    if (this.cubeCamera.coordinateSystem !== renderer.coordinateSystem) {
      this.cubeCamera.coordinateSystem = renderer.coordinateSystem;
      this.cubeCamera.updateCoordinateSystem();
      this.cubeCamera.updateMatrixWorld(true);
    }
    const previous = renderer.getRenderTarget();
    const previousFace = renderer.getActiveCubeFace();
    const previousMip = renderer.getActiveMipmapLevel();
    // reuse the shadow map the main pass drew, six more sun renders would cost more than the probe
    const shadowAuto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    for (let face = from; face < to; face += 1) {
      renderer.setRenderTarget(this.cube, face);
      renderer.render(scene, this.cubeCamera.children[face] as Camera);
    }
    renderer.shadowMap.autoUpdate = shadowAuto;
    renderer.setRenderTarget(previous, previousFace, previousMip);
  }
}
