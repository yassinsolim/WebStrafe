import { Color, Group, Mesh, MeshStandardMaterial } from 'three';
import type { PlayerModel } from '../network/types';
import { createPlayerModel } from '../multiplayer/ProceduralPlayer';
import { applyKnifeIdlePose, buildArmRig, type ArmRig } from '../multiplayer/playerRig';
import { ArmorCharacter } from './ArmorCharacter';
import { CharacterLibrary } from './library';
import type { CharacterLook } from './look';

export interface CharacterOptions {
  /** 'stance' holds the knife idle and breathes on update, 'none' leaves the bones to the caller */
  pose?: 'stance' | 'none';
  /** pin a level of detail, default switches by camera distance */
  lod?: 0 | 1 | 2 | 'auto';
}

/** one dressed character. feet at y = 0, facing +z, left side on +x */
export interface CharacterHandle {
  readonly root: Group;
  readonly rig: ArmRig | null;
  readonly look: CharacterLook;
  readonly team: PlayerModel;
  /** swaps pieces and paint in place; the skeleton and its pose survive */
  setLook(look: CharacterLook, team?: PlayerModel): void;
  /** idle breathing and cloth sway */
  update(dt: number, nowSec: number): void;
  dispose(): void;
}

let libraryPromise: Promise<CharacterLibrary | null> | null = null;

/**
 * loads the armor library once (about 1-2 MB). resolves null when it can't be
 * fetched, callers then fall back to the old procedural soldiers.
 */
export function loadCharacterLibrary(): Promise<CharacterLibrary | null> {
  libraryPromise ??= CharacterLibrary.load().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.warn('[Characters] armor library failed to load, using fallback models:', error);
    return null;
  });
  return libraryPromise;
}

/** test and tooling hook: use an already loaded library */
export function provideCharacterLibrary(library: CharacterLibrary | null): void {
  libraryPromise = Promise.resolve(library);
}

// fallback when the library is missing: the old procedural body, tinted
class PlaceholderCharacter implements CharacterHandle {
  public readonly root = new Group();
  public rig: ArmRig | null = null;
  public look: CharacterLook;
  public team: PlayerModel;

  constructor(look: CharacterLook, team: PlayerModel, private readonly options: CharacterOptions) {
    this.look = look;
    this.team = team;
    this.root.name = 'Character';
    this.rebuild();
  }

  setLook(look: CharacterLook, team: PlayerModel = this.team): void {
    this.look = look;
    const teamChanged = team !== this.team;
    this.team = team;
    if (teamChanged) this.rebuild();
    else this.tint();
  }

  update(_dt: number, nowSec: number): void {
    if (this.rig && this.options.pose !== 'none') applyKnifeIdlePose(this.rig, Math.sin(nowSec * 1.4));
  }

  dispose(): void {
    this.root.removeFromParent();
    this.root.clear();
  }

  private rebuild(): void {
    this.root.clear();
    const model = createPlayerModel(this.team);
    this.root.add(model);
    this.rig = buildArmRig(model);
    this.tint();
  }

  private tint(): void {
    const primary = new Color(this.look.primary);
    this.root.traverse((node) => {
      if (node instanceof Mesh && node.material instanceof MeshStandardMaterial) {
        node.material.color.lerp(primary, 0.35);
      }
    });
  }
}

/** builds a character right away from a loaded library (or the fallback when null) */
export function createCharacterSync(
  library: CharacterLibrary | null,
  look: CharacterLook,
  team: PlayerModel,
  options: CharacterOptions = {},
): CharacterHandle {
  const opts = { pose: 'stance' as const, ...options };
  return library ? new ArmorCharacter(library, look, team, opts) : new PlaceholderCharacter(look, team, opts);
}

export async function createCharacter(
  look: CharacterLook,
  team: PlayerModel,
  options: CharacterOptions = {},
): Promise<CharacterHandle> {
  return createCharacterSync(await loadCharacterLibrary(), look, team, options);
}
