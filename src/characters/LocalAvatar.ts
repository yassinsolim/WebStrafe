import { Group, type Object3D, Vector3 } from 'three';
import type { PlayerModel } from '../network/types';
import { attachKnifeModel, loadKnifeMesh } from '../multiplayer/playerRig';
import { createCharacter, type CharacterHandle } from './CharacterFactory';
import type { CharacterLook } from './look';

/** the model faces +z, the game's yaw 0 looks down -z */
const MODEL_YAW_OFFSET = Math.PI;

/**
 * your own character, drawn only when the camera leaves your head (the
 * third-person debug camera). it follows the movement controller's feet and
 * yaw, so what you see is what everyone else sees of you.
 */
export class LocalAvatar {
  public readonly root = new Group();
  private character: CharacterHandle | null = null;
  private look: CharacterLook;
  private team: PlayerModel;
  private building = false;
  private knife: Object3D | null = null;
  private readonly lastFeet = new Vector3();
  private readonly velocity = new Vector3();

  constructor(look: CharacterLook, team: PlayerModel) {
    this.look = look;
    this.team = team;
    this.root.name = 'LocalAvatar';
    this.root.visible = false;
  }

  setLook(look: CharacterLook, team: PlayerModel): void {
    this.look = look;
    this.team = team;
    this.character?.setLook(look, team);
  }

  update(dt: number, nowSec: number, feet: Vector3, yaw: number, visible: boolean): void {
    this.root.visible = visible;
    if (!visible) {
      this.lastFeet.copy(feet);
      return;
    }
    if (!this.character) {
      void this.build();
      return;
    }
    if (dt > 0) {
      const step = feet.clone().sub(this.lastFeet).divideScalar(dt);
      if (step.lengthSq() < 40 * 40) this.velocity.lerp(step, 1 - Math.exp(-dt * 8));
    }
    this.lastFeet.copy(feet);
    this.root.position.copy(feet);
    this.root.rotation.set(0, yaw + MODEL_YAW_OFFSET, 0);
    (this.character as { setVelocity?: (v: Vector3) => void }).setVelocity?.(this.velocity);
    this.character.update(dt, nowSec);
  }

  dispose(): void {
    this.character?.dispose();
    this.character = null;
    this.root.removeFromParent();
  }

  private async build(): Promise<void> {
    if (this.building) return;
    this.building = true;
    const [character, knife] = await Promise.all([
      createCharacter(this.look, this.team, { pose: 'stance' }),
      this.knife ? Promise.resolve(this.knife) : loadKnifeMesh().catch(() => null),
    ]);
    this.knife = knife;
    character.setLook(this.look, this.team);
    if (character.rig) attachKnifeModel(character.rig.rightWeaponHand, knife);
    this.character = character;
    this.root.add(character.root);
  }
}
