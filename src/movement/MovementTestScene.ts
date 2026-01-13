import {
  BoxGeometry,
  Color,
  DataTexture,
  GridHelper,
  Group,
  Mesh,
  MeshStandardMaterial,
  NearestFilter,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
} from 'three';

export interface MovementTestSceneResult {
  root: Group;
  spawn: Vector3;
}

export function createMovementTestScene(): MovementTestSceneResult {
  const root = new Group();
  root.name = 'MovementTestScene';

  const checker = createCheckerTexture('#2e485b', '#24394b', 64);
  checker.wrapS = RepeatWrapping;
  checker.wrapT = RepeatWrapping;
  checker.repeat.set(36, 36);

  const catchFloor = new Mesh(
    new BoxGeometry(520, 20, 520),
    new MeshStandardMaterial({ color: new Color('#2c4458') }),
  );
  catchFloor.position.set(0, -22, 0);
  catchFloor.receiveShadow = true;
  root.add(catchFloor);

  const mainFloor = new Mesh(
    new BoxGeometry(220, 2, 220),
    new MeshStandardMaterial({
      color: new Color('#4f6d85'),
      map: checker,
      roughness: 0.95,
      metalness: 0.02,
    }),
  );
  mainFloor.position.set(0, -1, 0);
  mainFloor.receiveShadow = true;
  root.add(mainFloor);

  const grid = new GridHelper(220, 110, 0x87a9c4, 0x3e5c75);
  grid.position.y = 0.02;
  root.add(grid);

  const spawnPlatform = new Mesh(
    new BoxGeometry(16, 2, 16),
    new MeshStandardMaterial({ color: new Color('#9bbad4') }),
  );
  spawnPlatform.position.set(0, 1.2, 56);
  root.add(spawnPlatform);

  const walkableRamp = createRamp({
    width: 30,
    thickness: 8,
    depth: 24,
    angleDeg: 26,
    position: new Vector3(-48, 5.5, 18),
    color: '#84b8c8',
  });
  walkableRamp.name = 'WalkableRamp_26deg';

  const surfRamp = createRamp({
    width: 34,
    thickness: 10,
    depth: 30,
    angleDeg: 56,
    position: new Vector3(16, 7.2, 2),
    color: '#69b6aa',
  });
  surfRamp.name = 'SurfRamp_56deg';

  const steepRamp = createRamp({
    width: 26,
    thickness: 10,
    depth: 24,
    angleDeg: 78,
    position: new Vector3(62, 8.8, -12),
    color: '#b67b7b',
  });
  steepRamp.name = 'SteepRamp_78deg';

  root.add(walkableRamp, surfRamp, steepRamp);

  const directionTower = new Mesh(
    new BoxGeometry(4, 16, 4),
    new MeshStandardMaterial({ color: new Color('#d7b16a') }),
  );
  directionTower.position.set(0, 8, 44);
  root.add(directionTower);

  const spawn = new Vector3(0, 4.5, 56);
  return { root, spawn };
}

interface RampOptions {
  width: number;
  thickness: number;
  depth: number;
  angleDeg: number;
  position: Vector3;
  color: string;
}

function createRamp(options: RampOptions): Mesh {
  const ramp = new Mesh(
    new BoxGeometry(options.width, options.thickness, options.depth),
    new MeshStandardMaterial({
      color: new Color(options.color),
      roughness: 0.88,
      metalness: 0.04,
    }),
  );
  ramp.position.copy(options.position);
  const angleRad = (options.angleDeg * Math.PI) / 180;
  ramp.quaternion.copy(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), angleRad));
  return ramp;
}

function createCheckerTexture(colorA: string, colorB: string, size: number): DataTexture {
  const data = new Uint8Array(size * size * 3);
  const a = hexToRgb(colorA);
  const b = hexToRgb(colorB);
  const cells = 8;
  const cellSize = size / cells;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const idx = (y * size + x) * 3;
      const useA = (Math.floor(x / cellSize) + Math.floor(y / cellSize)) % 2 === 0;
      const c = useA ? a : b;
      data[idx + 0] = c.r;
      data[idx + 1] = c.g;
      data[idx + 2] = c.b;
    }
  }

  const texture = new DataTexture(data, size, size);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  const value = Number.parseInt(clean, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

export interface MovementAcceptanceLog {
  bunnyhopSpeed: number;
  airStrafeGain: number;
  surfSpeed: number;
}

export function logMovementAcceptance(log: MovementAcceptanceLog): void {
  const report = [
    `[MovementTestScene] Bunnyhop speed: ${log.bunnyhopSpeed.toFixed(2)} m/s`,
    `[MovementTestScene] Air-strafe gain: ${log.airStrafeGain.toFixed(2)} m/s`,
    `[MovementTestScene] Surf speed: ${log.surfSpeed.toFixed(2)} m/s`,
  ];
  for (const line of report) {
    // eslint-disable-next-line no-console
    console.log(line);
  }
}
