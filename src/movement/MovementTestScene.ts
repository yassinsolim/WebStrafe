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
  catchFloor.name = 'SafetyCatchFloor';
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
  mainFloor.name = 'TrainingFloor';
  mainFloor.position.set(0, -1, 0);
  mainFloor.receiveShadow = true;
  root.add(mainFloor);

  const grid = new GridHelper(220, 110, 0x9fc9e6, 0x3e5c75);
  grid.name = 'TrainingGrid';
  grid.position.y = 0.02;
  root.add(grid);

  // Compact firing bay: a clear backstop and side walls make nearby wall and
  // ground impacts easy to practice without turning the map into a flat void.
  const backstop = new Mesh(
    new BoxGeometry(30, 6.5, 1),
    new MeshStandardMaterial({
      color: new Color('#2b4056'),
      roughness: 0.82,
      metalness: 0.04,
    }),
  );
  backstop.name = 'FirearmBackstop';
  backstop.position.set(0, 3.25, 26);
  root.add(backstop);

  const sideWallMaterial = new MeshStandardMaterial({
    color: new Color('#456f83'),
    roughness: 0.86,
    metalness: 0.03,
  });
  const leftWall = new Mesh(new BoxGeometry(1, 4, 27), sideWallMaterial);
  leftWall.name = 'RangeWallLeft';
  leftWall.position.set(-15, 2, 38.5);
  const rightWall = new Mesh(new BoxGeometry(1, 4, 27), sideWallMaterial);
  rightWall.name = 'RangeWallRight';
  rightWall.position.set(15, 2, 38.5);
  root.add(leftWall, rightWall);

  // This offset slab is deliberately visible from spawn. Strafe left behind it
  // to break bot LOS, wait safely, then peek right to restart the normal reaction
  // window. It is ordinary collision geometry shared by client and authorities.
  const peekCover = new Mesh(
    new BoxGeometry(4.5, 3.2, 1.2),
    new MeshStandardMaterial({
      color: new Color('#b86f46'),
      roughness: 0.9,
      metalness: 0.02,
    }),
  );
  peekCover.name = 'PeekCover';
  peekCover.position.set(-3.25, 1.6, 49.8);
  root.add(peekCover);

  const impactPanel = new Mesh(
    new BoxGeometry(4.2, 4.2, 0.8),
    new MeshStandardMaterial({
      color: new Color('#d4a653'),
      roughness: 0.78,
      metalness: 0.05,
    }),
  );
  impactPanel.name = 'ImpactPanel';
  impactPanel.position.set(8, 2.1, 41);
  root.add(impactPanel);

  // Raise the staged bot just enough that the level spawn crosshair intersects
  // its torso. A short upward adjustment then reaches the real head capsule,
  // making both body and head practice intentional rather than pixel hunting.
  const botStagingPad = new Mesh(
    new BoxGeometry(4, 0.4, 3.2),
    new MeshStandardMaterial({
      color: new Color('#608da0'),
      roughness: 0.88,
      metalness: 0.03,
    }),
  );
  botStagingPad.name = 'BotStagingPad';
  botStagingPad.position.set(0, 0.2, 44.5);
  root.add(botStagingPad);

  // The bot stages in front of these high-contrast body/head references. They
  // help ordinary players learn body versus head aim without fake targets or
  // fabricated hit events; only shots into the real bot produce hitmarkers.
  const torsoReference = new Mesh(
    new BoxGeometry(1.8, 1.25, 0.12),
    new MeshStandardMaterial({ color: new Color('#73b7a8'), roughness: 0.82 }),
  );
  torsoReference.name = 'BodyAimReference';
  torsoReference.position.set(0, 1.18, 26.58);
  const headReference = new Mesh(
    new BoxGeometry(0.72, 0.48, 0.12),
    new MeshStandardMaterial({ color: new Color('#d7c27a'), roughness: 0.82 }),
  );
  headReference.name = 'HeadAimReference';
  headReference.position.set(0, 2.12, 26.58);
  root.add(torsoReference, headReference);

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

  const spawn = new Vector3(0, 0.04, 56);
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
  // DataTexture defaults to RGBAFormat, so its backing store must contain four
  // channels per pixel. Supplying RGB-sized data makes WebGL reject the upload
  // with INVALID_OPERATION when this scene first renders.
  const data = new Uint8Array(size * size * 4);
  const a = hexToRgb(colorA);
  const b = hexToRgb(colorB);
  const cells = 8;
  const cellSize = size / cells;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const idx = (y * size + x) * 4;
      const useA = (Math.floor(x / cellSize) + Math.floor(y / cellSize)) % 2 === 0;
      const c = useA ? a : b;
      data[idx + 0] = c.r;
      data[idx + 1] = c.g;
      data[idx + 2] = c.b;
      data[idx + 3] = 255;
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
