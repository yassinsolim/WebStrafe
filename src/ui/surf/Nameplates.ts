import './surf.css';
import { Vector3, type Camera } from 'three';

export interface NameplateSource {
  id: string;
  position: Vector3;
}

export interface NameplateInfo {
  name: string;
  /** undefined for transports that don't carry the flag */
  pvp?: boolean;
  isBot?: boolean;
}

const HEAD_HEIGHT = 2.05;
const MAX_DISTANCE = 90;

/**
 * dom nameplates over remote players with their pvp state, projected from the
 * poses the remote renderer actually drew this frame.
 */
export class Nameplates {
  readonly root: HTMLDivElement;
  private readonly plates = new Map<string, { el: HTMLDivElement; name: HTMLSpanElement; mode: HTMLSpanElement; key: string }>();
  private readonly scratch = new Vector3();

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'surf-nameplates';
    parent.appendChild(this.root);
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  update(
    camera: Camera,
    players: readonly NameplateSource[],
    info: (id: string) => NameplateInfo | null,
    width: number,
    height: number,
  ): void {
    const seen = new Set<string>();
    for (const p of players) {
      const meta = info(p.id);
      if (!meta) continue;
      seen.add(p.id);
      const plate = this.plate(p.id);
      const key = `${meta.name}|${meta.pvp}|${meta.isBot}`;
      if (key !== plate.key) {
        plate.key = key;
        plate.name.textContent = meta.name;
        const known = meta.pvp !== undefined || meta.isBot;
        plate.mode.hidden = !known;
        plate.mode.textContent = meta.isBot ? 'BOT' : meta.pvp ? 'PVP' : 'PEACEFUL';
        plate.el.classList.toggle('is-pvp', meta.isBot === true || meta.pvp === true);
        plate.el.classList.toggle('is-peaceful', !meta.isBot && meta.pvp === false);
      }
      this.scratch.copy(p.position);
      this.scratch.y += HEAD_HEIGHT;
      const distance = this.scratch.distanceTo(camera.position);
      this.scratch.project(camera);
      const onScreen = this.scratch.z > -1 && this.scratch.z < 1
        && Math.abs(this.scratch.x) < 1.1 && Math.abs(this.scratch.y) < 1.1
        && distance < MAX_DISTANCE;
      plate.el.hidden = !onScreen;
      if (onScreen) {
        const x = (this.scratch.x * 0.5 + 0.5) * width;
        const y = (-this.scratch.y * 0.5 + 0.5) * height;
        const scale = Math.max(0.7, Math.min(1.1, 14 / Math.max(distance, 1)));
        plate.el.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${scale.toFixed(2)})`;
      }
    }
    for (const [id, plate] of this.plates) {
      if (!seen.has(id)) {
        plate.el.remove();
        this.plates.delete(id);
      }
    }
  }

  clear(): void {
    for (const plate of this.plates.values()) plate.el.remove();
    this.plates.clear();
  }

  private plate(id: string) {
    let plate = this.plates.get(id);
    if (!plate) {
      const el = document.createElement('div');
      el.className = 'surf-nameplate';
      const name = document.createElement('span');
      const mode = document.createElement('span');
      mode.className = 'surf-nameplate-mode';
      el.append(name, mode);
      this.root.appendChild(el);
      plate = { el, name, mode, key: '' };
      this.plates.set(id, plate);
    }
    return plate;
  }
}
