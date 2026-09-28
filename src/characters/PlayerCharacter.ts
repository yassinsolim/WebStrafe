import type { Scene, Vector3 } from 'three';
import type { PlayerModel } from '../network/types';
import type { MainMenu } from '../ui/MainMenu';
import { CustomizeScreen } from '../ui/customize/CustomizeScreen';
import { loadCharacterLibrary } from './CharacterFactory';
import { LocalAvatar } from './LocalAvatar';
import { encodeLook, looksEqual, type CharacterLook } from './look';
import { hasStoredLook, loadLook } from './lookStore';
import { parseDevLook } from './devCharacters';

export interface PlayerCharacterOptions {
  container: HTMLElement;
  worldScene: Scene;
  team: PlayerModel;
  /** the look changed for good (Done in the customize screen, or a team default swap) */
  onLookChanged: (look: CharacterLook) => void;
  /** first-person arms that wear the look */
  viewmodel?: { setArmsLook(look: CharacterLook): void };
}

/**
 * the local player's character: the saved look, the customize screen, the
 * menu stage and the third-person avatar. GameApp talks to this one object.
 */
export class PlayerCharacter {
  private lookValue: CharacterLook;
  private team: PlayerModel;
  private screen: CustomizeScreen | null = null;
  private menu: MainMenu | null = null;
  private readonly avatar: LocalAvatar;

  constructor(private readonly options: PlayerCharacterOptions) {
    this.team = options.team;
    this.lookValue = parseDevLook(globalThis.location?.search ?? '', options.team) ?? loadLook(options.team);
    this.avatar = new LocalAvatar(this.lookValue, this.team);
    options.worldScene.add(this.avatar.root);
    options.viewmodel?.setArmsLook(this.lookValue);
    // start fetching the armor library behind the menu
    void loadCharacterLibrary();
  }

  get look(): CharacterLook {
    return this.lookValue;
  }

  /** the look as sent in join/presence */
  wire(): string {
    return encodeLook(this.lookValue);
  }

  attachMenu(menu: MainMenu): void {
    this.menu = menu;
    menu.setCharacterLook(this.lookValue);
  }

  /** the side changed; an uncustomized player takes the new side's default look */
  setTeam(team: PlayerModel): void {
    if (team === this.team) return;
    this.team = team;
    const next = hasStoredLook() ? this.lookValue : loadLook(team);
    this.apply(next, !looksEqual(next, this.lookValue));
  }

  /** qa and tooling: wear a look now (not saved) and share it like Done would */
  wearForTest(look: CharacterLook): void {
    this.apply(look, true);
  }

  openCustomize(): void {
    this.screen ??= new CustomizeScreen(this.options.container, {
      onClose: (look, saved) => {
        this.menu?.setVisible(true);
        if (saved) this.apply(look, true);
        else this.menu?.setCharacterLook(this.lookValue);
      },
    });
    // the screen is opaque; hiding the menu also pauses its 3d stage
    this.menu?.setVisible(false);
    this.screen.open(this.lookValue, this.team);
  }

  isCustomizing(): boolean {
    return this.screen?.isOpen() ?? false;
  }

  /** per frame: the avatar only shows when the camera is out of your head */
  update(dt: number, nowSec: number, feet: Vector3, yawRad: number, thirdPerson: boolean): void {
    this.avatar.update(dt, nowSec, feet, yawRad, thirdPerson);
  }

  dispose(): void {
    this.screen?.dispose();
    this.avatar.dispose();
  }

  private apply(look: CharacterLook, notify: boolean): void {
    this.lookValue = look;
    this.avatar.setLook(look, this.team);
    this.menu?.setCharacterLook(look);
    this.options.viewmodel?.setArmsLook(look);
    if (notify) this.options.onLookChanged(look);
  }
}
