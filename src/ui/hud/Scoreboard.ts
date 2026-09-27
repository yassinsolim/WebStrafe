import type { ScoreboardRow } from './ScoreboardTally';

export interface ScoreboardView {
  mapName: string;
  mapType: string;
  rows: ScoreboardRow[];
  localPingMs: number | null;
}

/** the hold-Tab scoreboard overlay; pure view, rows come from ScoreboardTally */
export class Scoreboard {
  readonly root: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly subtitle: HTMLDivElement;
  private readonly body: HTMLTableSectionElement;
  private readonly footer: HTMLDivElement;
  private lastKey = '';

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud-scoreboard';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Scoreboard');

    const header = document.createElement('div');
    header.className = 'hud-sb-header';
    this.title = document.createElement('div');
    this.title.className = 'hud-sb-title';
    this.subtitle = document.createElement('div');
    this.subtitle.className = 'hud-sb-subtitle';
    header.append(this.title, this.subtitle);

    const table = document.createElement('table');
    table.className = 'hud-sb-table';
    const head = document.createElement('thead');
    head.innerHTML = '<tr><th class="hud-sb-name">Player</th><th>K</th><th>D</th><th>Ping</th></tr>';
    this.body = document.createElement('tbody');
    table.append(head, this.body);

    this.footer = document.createElement('div');
    this.footer.className = 'hud-sb-footer';
    this.root.append(header, table, this.footer);
    parent.appendChild(this.root);
  }

  setOpen(open: boolean): void {
    this.root.hidden = !open;
  }

  isOpen(): boolean {
    return !this.root.hidden;
  }

  render(view: ScoreboardView): void {
    const key = JSON.stringify(view);
    if (key === this.lastKey) {
      return;
    }
    this.lastKey = key;
    this.title.textContent = view.mapName;
    const count = view.rows.length;
    this.subtitle.textContent = `${view.mapType} · ${count} ${count === 1 ? 'player' : 'players'} · scores since you joined`;
    this.body.replaceChildren();
    if (count === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 4;
      cell.className = 'hud-sb-empty';
      cell.textContent = 'Nobody else here yet';
      row.appendChild(cell);
      this.body.appendChild(row);
    }
    for (const entry of view.rows) {
      const row = document.createElement('tr');
      row.classList.toggle('is-local', entry.isLocal);
      row.classList.toggle('is-dead', !entry.alive);
      const name = document.createElement('td');
      name.className = 'hud-sb-name';
      name.textContent = entry.name;
      if (entry.isBot) {
        const tag = document.createElement('span');
        tag.className = 'hud-sb-tag';
        tag.textContent = 'BOT';
        name.appendChild(tag);
      }
      row.append(
        name,
        cell(String(entry.kills)),
        cell(String(entry.deaths)),
        cell(entry.isBot ? 'BOT' : entry.pingMs === null ? '--' : String(entry.pingMs)),
      );
      this.body.appendChild(row);
    }
    this.footer.textContent = view.localPingMs === null
      ? 'Your ping: not measured on this connection'
      : `Your ping: ${Math.round(view.localPingMs)} ms`;
  }
}

function cell(text: string): HTMLTableCellElement {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}
