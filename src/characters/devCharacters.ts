import type { MultiplayerSnapshotPlayer, PlayerModel } from '../network/types';
import { devToolsEnabled } from '../app/devTools';
import { ARMOR_SETS, ARMOR_SLOTS, type ArmorSetId } from './catalog';
import type { CharacterLibrary } from './library';
import { decodeLook, defaultLook, encodeLook, lookForBot, randomLook, type CharacterLook } from './look';
import { BUILTIN_PRESETS } from './presets';

/**
 * dev and preview only: `?chars=<n>&charlook=max|presets|random|<wire>` puts n
 * standing characters in a row in front of the camera, for perf runs and
 * screenshots. they are plain snapshot rows, the same path real players take.
 */
export interface DevCharacterRequest {
  count: number;
  mode: string;
  /** metres in front of the eye the row stands at */
  distance: number;
  spacing: number;
  /** start in the third-person debug camera (your own character from behind) */
  thirdPerson: boolean;
}

export function parseDevCharacters(search: string, enabled = devToolsEnabled()): DevCharacterRequest | null {
  if (!enabled) return null;
  const params = new URLSearchParams(search);
  const count = Math.min(24, Math.max(0, Math.floor(Number(params.get('chars') ?? 0) || 0)));
  if (!count && params.get('cam') !== 'third') return null;
  return {
    count,
    mode: params.get('charlook') ?? 'presets',
    distance: Number(params.get('chardist') ?? 4.5) || 4.5,
    spacing: Number(params.get('charspace') ?? 1.1) || 1.1,
    thirdPerson: params.get('cam') === 'third',
  };
}

/** dev and preview only: `?look=<wire>` wears a look for this page load without saving it */
export function parseDevLook(search: string, team: PlayerModel, enabled = devToolsEnabled()): CharacterLook | null {
  if (!enabled) return null;
  const wire = new URLSearchParams(search).get('look');
  return wire ? decodeLook(wire, defaultLook(team)) : null;
}

/** the heaviest combination the library has: most triangles in every slot, plus emblem and tag */
export function maxLook(library: CharacterLibrary | null): CharacterLook {
  const pick = (slot: string): ArmorSetId => {
    if (!library) return 'quill';
    let best: ArmorSetId = 'strafe';
    let most = -1;
    for (const set of ARMOR_SETS) {
      const tris = library.get(slot, set, 0).reduce((sum, p) => sum + p.index.length / 3, 0);
      if (tris > most) {
        most = tris;
        best = set;
      }
    }
    return best;
  };
  const pieces = Object.fromEntries(ARMOR_SLOTS.map((slot) => [slot, pick(slot)])) as Record<(typeof ARMOR_SLOTS)[number], ArmorSetId>;
  return {
    ...pieces,
    primary: '#9e2231',
    secondary: '#2b2e33',
    accent: '#c9a43c',
    finish: 'worn',
    emblem: 'crown',
    tag: 'MAX-LOOK',
    watch: true,
  };
}

/** the wire look for the i-th character of a dev row */
function cosmeticsFor(mode: string, index: number, library: CharacterLibrary | null): string {
  if (mode === 'max') return encodeLook(maxLook(library));
  if (mode === 'random') return encodeLook(randomLook(index * 7919 + 13));
  if (mode === 'bots') return encodeLook(lookForBot(`bot:${index}`));
  if (mode.startsWith('1.')) {
    // a comma list of wire looks, repeated
    const wires = mode.split(',');
    return wires[index % wires.length];
  }
  return encodeLook(BUILTIN_PRESETS[index % BUILTIN_PRESETS.length].look);
}

/** rows for a line of characters facing the viewer */
export function devCharacterRows(
  request: DevCharacterRequest,
  eye: { x: number; y: number; z: number },
  feetY: number,
  yawRad: number,
  library: CharacterLibrary | null,
): MultiplayerSnapshotPlayer[] {
  const forward = { x: -Math.sin(yawRad), z: -Math.cos(yawRad) };
  const right = { x: Math.cos(yawRad), z: -Math.sin(yawRad) };
  const rows: MultiplayerSnapshotPlayer[] = [];
  for (let i = 0; i < request.count; i += 1) {
    const offset = (i - (request.count - 1) / 2) * request.spacing;
    const team: PlayerModel = i % 2 === 0 ? 'terrorist' : 'counterterrorist';
    const cosmetics = cosmeticsFor(request.mode, i, library);
    rows.push({
      id: `dev:${i}`,
      name: `Dev ${i + 1}`,
      model: team,
      position: [
        eye.x + forward.x * request.distance + right.x * offset,
        feetY,
        eye.z + forward.z * request.distance + right.z * offset,
      ],
      velocity: [0, 0, 0],
      // face the camera
      yaw: yawRad + Math.PI,
      pitch: 0,
      cosmetics,
    });
  }
  return rows;
}
