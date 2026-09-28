import { formatPing, pingLevel } from './hudFormat';
import { createIcon, iconMarkup } from './icons';
import type { ScoreboardRow } from './ScoreboardTally';

export interface ScoreboardView {
  mapName: string;
  mapType: string;
  /** free for all combat, otherwise a movement map */
  combat?: boolean;
  rows: ScoreboardRow[];
  localPingMs: number | null;
}

/** the hold-Tab scoreboard overlay; pure view, rows come from ScoreboardTally */
export class Scoreboard {
  readonly root: HTMLDivElement;
  private readonly mode: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly count: HTMLElement;
  private readonly body: HTMLTableSectionElement;
  private readonly footerPing: HTMLSpanElement;
  private open = false;
  private lastKey = '';

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud-scoreboard';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Scoreboard');
    this.root.setAttribute('aria-hidden', 'true');

    const header = document.createElement('div');
    header.className = 'hud-sb-header';
    const map = document.createElement('div');
    map.className = 'hud-sb-map';
    this.mode = document.createElement('div');
    this.mode.className = 'hud-sb-mode';
    this.title = document.createElement('div');
    this.title.className = 'hud-sb-title';
    map.append(this.mode, this.title);
    const players = document.createElement('div');
    players.className = 'hud-sb-count';
    players.append(createIcon('players', 'hud-sb-count-icon'));
    this.count = document.createElement('b');
    const countLabel = document.createElement('span');
    countLabel.textContent = 'in server';
    players.append(this.count, countLabel);
    header.append(map, players);

    const table = document.createElement('table');
    table.className = 'hud-sb-table';
    const head = document.createElement('thead');
    head.innerHTML = '<tr><th class="hud-sb-place">#</th><th class="hud-sb-name">Player</th>'
      + '<th class="hud-sb-num">K</th><th class="hud-sb-num">D</th><th class="hud-sb-num hud-sb-ping">Ping</th></tr>';
    this.body = document.createElement('tbody');
    table.append(head, this.body);

    const footer = document.createElement('div');
    footer.className = 'hud-sb-footer';
    this.footerPing = document.createElement('span');
    const note = document.createElement('span');
    note.className = 'hud-sb-note';
    note.textContent = 'Scores count from when you joined';
    footer.append(this.footerPing, note);
    this.root.append(header, table, footer);
    parent.appendChild(this.root);
  }

  setOpen(open: boolean): void {
    if (open === this.open) {
      return;
    }
    this.open = open;
    this.root.classList.toggle('is-open', open);
    this.root.setAttribute('aria-hidden', String(!open));
  }

  isOpen(): boolean {
    return this.open;
  }

  render(view: ScoreboardView): void {
    const key = JSON.stringify(view);
    if (key === this.lastKey) {
      return;
    }
    this.lastKey = key;
    this.title.textContent = view.mapName;
    this.mode.textContent = view.combat ? `${view.mapType} · Free for all` : view.mapType;
    const count = view.rows.length;
    this.count.textContent = String(count);
    this.body.replaceChildren();
    if (count === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 5;
      cell.className = 'hud-sb-empty';
      cell.textContent = 'Nobody else here yet';
      row.appendChild(cell);
      this.body.appendChild(row);
    }
    let place = 0;
    let lastKills = Number.NaN;
    view.rows.forEach((entry, index) => {
      // players level on kills share a place
      if (entry.kills !== lastKills) {
        place = index + 1;
        lastKills = entry.kills;
      }
      const row = document.createElement('tr');
      row.classList.toggle('is-local', entry.isLocal);
      row.classList.toggle('is-dead', !entry.alive);
      row.classList.toggle('is-first', place === 1 && entry.kills > 0);

      const placeCell = cell(String(place), 'hud-sb-place');
      const name = document.createElement('td');
      name.className = 'hud-sb-name';
      const nameText = document.createElement('span');
      nameText.className = 'hud-sb-player';
      nameText.textContent = entry.name;
      name.appendChild(nameText);
      if (entry.isLocal) {
        name.insertAdjacentHTML('beforeend', '<span class="hud-sb-tag is-you">You</span>');
      }
      if (entry.isBot) {
        name.insertAdjacentHTML('beforeend', '<span class="hud-sb-tag">Bot</span>');
      }
      if (!entry.alive) {
        name.insertAdjacentHTML('afterbegin', iconMarkup('skull', 'hud-sb-dead'));
      }
      const ping = cell(formatPing(entry.pingMs, entry.isBot), 'hud-sb-num hud-sb-ping');
      ping.dataset.level = entry.isBot ? 'none' : pingLevel(entry.pingMs);
      row.append(
        placeCell,
        name,
        cell(String(entry.kills), 'hud-sb-num hud-sb-kills'),
        cell(String(entry.deaths), 'hud-sb-num'),
        ping,
      );
      this.body.appendChild(row);
    });
    this.footerPing.textContent = view.localPingMs === null
      ? 'Your ping: not measured on this connection'
      : `Your ping: ${Math.round(view.localPingMs)} ms`;
  }
}

function cell(text: string, className: string): HTMLTableCellElement {
  const td = document.createElement('td');
  td.className = className;
  td.textContent = text;
  return td;
}
