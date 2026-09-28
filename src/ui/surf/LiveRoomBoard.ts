import './surf.css';
import { formatRunTime } from '../hud/hudMath';

export interface RoomKillRow {
  id: string;
  name: string;
  kills: number;
  deaths: number;
  pvp: boolean | undefined;
  isLocal: boolean;
}

export interface MapTimeRow {
  name: string;
  timeMs: number;
  pvp: boolean;
  isLocal: boolean;
}

export interface LiveRoomView {
  kills: RoomKillRow[];
  /** null hides the section (maps without a timer) */
  times: MapTimeRow[] | null;
  timesNote: string;
  pbMs: number | null;
}

/**
 * hold tab panel next to the scoreboard: live room kills from the host's
 * authoritative tally and the map's top times. listens for tab itself so the
 * hud's scoreboard code stays untouched.
 */
export class LiveRoomBoard {
  readonly root: HTMLDivElement;
  private readonly killsList: HTMLOListElement;
  private readonly killsSub: HTMLSpanElement;
  private readonly timesSection: HTMLDivElement;
  private readonly timesList: HTMLOListElement;
  private readonly timesSub: HTMLSpanElement;
  private enabled = false;
  private held = false;
  private key = '';

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'surf-room-board';
    this.root.hidden = true;
    this.root.setAttribute('aria-label', 'Room board');

    const kills = section('Room kills');
    this.killsSub = kills.sub;
    this.killsList = kills.list;
    const times = section('Map times');
    this.timesSection = times.root;
    this.timesSub = times.sub;
    this.timesList = times.list;
    this.root.append(kills.root, times.root);
    parent.appendChild(this.root);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.root.remove();
  }

  /** only while playing, so tab in the menu keeps its normal focus behaviour */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.held = false;
    this.root.hidden = !(this.enabled && this.held);
  }

  isOpen(): boolean {
    return !this.root.hidden;
  }

  render(view: LiveRoomView): void {
    if (this.root.hidden) return;
    const key = JSON.stringify(view);
    if (key === this.key) return;
    this.key = key;

    this.killsSub.textContent = 'live · this room';
    this.killsList.replaceChildren();
    if (view.kills.length === 0) {
      this.killsList.appendChild(empty('No one has scored yet'));
    }
    view.kills.forEach((row, i) => {
      const mark: [string, string] | null = row.pvp === undefined
        ? null
        : row.pvp ? ['PVP', 'is-pvp'] : ['PEACE', 'is-peaceful'];
      this.killsList.appendChild(line(i + 1, row.name, `${row.kills} / ${row.deaths}`, row.isLocal, mark));
    });

    this.timesSection.hidden = view.times === null;
    if (view.times) {
      this.timesSub.textContent = view.pbMs !== null
        ? `your pb ${formatRunTime(view.pbMs)}`
        : view.times.length > 0 ? 'top 5' : '';
      this.timesList.replaceChildren();
      if (view.times.length === 0) {
        this.timesList.appendChild(empty(view.timesNote || 'No ranked runs yet'));
      }
      view.times.forEach((row, i) => {
        this.timesList.appendChild(line(i + 1, row.name, formatRunTime(row.timeMs), row.isLocal, row.pvp ? ['PVP', 'is-pvp'] : null));
      });
    }
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.code !== 'Tab' || !this.enabled) return;
    this.held = true;
    this.root.hidden = false;
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (event.code !== 'Tab') return;
    this.held = false;
    this.root.hidden = true;
  };

  private readonly onBlur = (): void => {
    this.held = false;
    this.root.hidden = true;
  };
}

function section(title: string) {
  const root = document.createElement('div');
  root.className = 'surf-board-section';
  const head = document.createElement('div');
  head.className = 'surf-board-head';
  const label = document.createElement('span');
  label.textContent = title;
  const sub = document.createElement('span');
  sub.className = 'surf-board-sub';
  head.append(label, sub);
  const list = document.createElement('ol');
  list.className = 'surf-board-rows';
  root.append(head, list);
  return { root, sub, list };
}

function line(rank: number, name: string, value: string, isLocal: boolean, mark: [string, string] | null): HTMLLIElement {
  const li = document.createElement('li');
  li.classList.toggle('is-local', isLocal);
  const r = document.createElement('span');
  r.className = 'rank';
  r.textContent = String(rank).padStart(2, '0');
  const n = document.createElement('span');
  n.className = 'name';
  n.textContent = name;
  if (mark) {
    const m = document.createElement('span');
    m.className = `mark ${mark[1]}`;
    m.textContent = mark[0];
    n.appendChild(m);
  }
  const v = document.createElement('span');
  v.className = 'value';
  v.textContent = value;
  li.append(r, n, v);
  return li;
}

function empty(text: string): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'surf-board-empty';
  li.textContent = text;
  return li;
}
