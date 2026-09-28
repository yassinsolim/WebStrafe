import './surf.css';
import { formatRunTime } from '../hud/hudMath';
import type { KillBoardRow, RunBoardRow, StageBoardRow, SurfBoards } from '../../surf/SurfBoards';

type BoardMode = 'times' | 'stages' | 'daily' | 'alltime';

const MODES: ReadonlyArray<[BoardMode, string]> = [
  ['times', 'Map times'],
  ['stages', 'Stages'],
  ['daily', 'Kills today'],
  ['alltime', 'Kills all time'],
];

/** how often an open panel refreshes itself */
export const BOARD_POLL_MS = 20_000;

export interface BoardsMap {
  id: string;
  name: string;
  /** number of stages (1 for linear maps), 0 when the map has no timer */
  stageCount: number;
}

/**
 * menu leaderboards: ranked map times, per stage bests and daily / all time
 * kills. mounts into the menu's leaderboard section and polls while that
 * section is on screen. when the database doesn't have the new tables yet it
 * hides itself and the legacy top runs list shows instead.
 */
export class LeaderboardPanel {
  readonly root: HTMLDivElement;
  private readonly modeButtons = new Map<BoardMode, HTMLButtonElement>();
  private readonly stagesRow: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly list: HTMLOListElement;
  private readonly status: HTMLDivElement;
  private mode: BoardMode = 'times';
  private stage = 1;
  private map: BoardsMap | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastLoadedAt = 0;
  private loading = false;
  private requestId = 0;

  constructor(
    private readonly host: HTMLElement,
    private readonly boards: SurfBoards,
    private readonly legacy: HTMLElement[],
    private readonly localName: () => string,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'surf-menu-boards';

    const modes = document.createElement('div');
    modes.className = 'surf-menu-modes';
    for (const [id, label] of MODES) {
      const b = chip(label, () => this.setMode(id));
      this.modeButtons.set(id, b);
      modes.appendChild(b);
    }
    this.stagesRow = document.createElement('div');
    this.stagesRow.className = 'surf-menu-stages';
    this.title = document.createElement('div');
    this.title.className = 'menu-map-info';
    this.list = document.createElement('ol');
    this.list.className = 'menu-leaderboard';
    this.status = document.createElement('div');
    this.status.className = 'surf-menu-status';
    this.root.append(modes, this.stagesRow, this.title, this.list, this.status);
    host.prepend(this.root);
    this.syncButtons();
    this.showLegacy(false);

    this.timer = setInterval(() => {
      if (this.isOnScreen() && performance.now() - this.lastLoadedAt >= BOARD_POLL_MS - 500) void this.load();
    }, 2000);
    new MutationObserver(() => {
      if (this.isOnScreen() && performance.now() - this.lastLoadedAt > 3000) void this.load();
    }).observe(host, { attributes: true, attributeFilter: ['hidden', 'class', 'style'] });
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.root.remove();
  }

  setMap(map: BoardsMap): void {
    this.map = map;
    if (this.stage > Math.max(1, map.stageCount)) this.stage = 1;
    this.syncButtons();
    void this.load();
  }

  /** refetch now, for example right after a run was submitted */
  refresh(): void {
    void this.load();
  }

  private setMode(mode: BoardMode): void {
    this.mode = mode;
    this.syncButtons();
    void this.load();
  }

  private isOnScreen(): boolean {
    return this.host.offsetParent !== null && !this.host.hidden;
  }

  private syncButtons(): void {
    for (const [id, b] of this.modeButtons) b.classList.toggle('is-active', id === this.mode);
    const stageCount = this.map?.stageCount ?? 0;
    this.stagesRow.replaceChildren();
    this.stagesRow.hidden = this.mode !== 'stages' || stageCount < 2;
    for (let s = 1; s <= stageCount && stageCount >= 2; s += 1) {
      const b = chip(`Stage ${s}`, () => {
        this.stage = s;
        this.syncButtons();
        void this.load();
      });
      b.classList.toggle('is-active', s === this.stage);
      this.stagesRow.appendChild(b);
    }
  }

  private async load(): Promise<void> {
    if (!this.boards.available) {
      this.showLegacy(true);
      return;
    }
    const id = ++this.requestId;
    this.loading = true;
    this.status.textContent = 'Loading...';
    const map = this.map;
    const mapName = map?.name ?? '';
    let rows: Array<{ name: string; value: string; mark?: string }> = [];
    let title = '';
    let emptyText = '';
    if (this.mode === 'times' || this.mode === 'stages') {
      if (!map || map.stageCount === 0) {
        title = mapName ? `${mapName} has no timer` : 'Pick a map';
        emptyText = 'Timed boards are for surf and bhop maps.';
      } else if (this.mode === 'times' || map.stageCount < 2) {
        title = `Top runs · ${mapName}`;
        emptyText = 'No ranked runs yet. Finish the map to set the first time.';
        const data: RunBoardRow[] = await this.boards.fetchMapBoard(map.id);
        rows = data.map((r) => ({ name: r.name, value: formatRunTime(r.timeMs), mark: r.pvp ? 'PVP' : undefined }));
      } else {
        title = `Stage ${this.stage} · ${mapName}`;
        emptyText = 'No stage times yet.';
        const data: StageBoardRow[] = await this.boards.fetchStageBoard(map.id, this.stage);
        rows = data.map((r) => ({ name: r.name, value: formatRunTime(r.timeMs) }));
      }
    } else {
      title = this.mode === 'daily' ? 'Most kills today (UTC)' : 'Most kills all time';
      emptyText = 'No kills recorded yet.';
      const data: KillBoardRow[] = await this.boards.fetchKills(this.mode);
      rows = data.map((r) => ({ name: r.name, value: `${r.kills} K  ${r.deaths} D` }));
    }
    if (id !== this.requestId) return;
    this.loading = false;
    if (!this.boards.available) {
      this.showLegacy(true);
      return;
    }
    this.lastLoadedAt = performance.now();
    this.title.textContent = title;
    this.list.replaceChildren();
    if (rows.length === 0) {
      const li = document.createElement('li');
      li.className = 'menu-leaderboard-empty';
      li.textContent = emptyText;
      this.list.appendChild(li);
    }
    const me = this.localName().toLowerCase();
    rows.forEach((row, index) => {
      const li = document.createElement('li');
      if (index < 3) li.classList.add(`is-top-${index + 1}`);
      const rank = document.createElement('span');
      rank.className = 'lb-rank';
      rank.textContent = String(index + 1).padStart(2, '0');
      const who = document.createElement('span');
      who.className = 'lb-name';
      who.textContent = row.name;
      if (row.name.toLowerCase() === me) who.style.color = 'var(--brand-soft)';
      if (row.mark) {
        const mark = document.createElement('span');
        mark.className = 'lb-mark';
        mark.textContent = row.mark;
        who.appendChild(mark);
      }
      const value = document.createElement('span');
      value.className = 'lb-time';
      value.textContent = row.value;
      li.append(rank, who, value);
      this.list.appendChild(li);
    });
    this.status.innerHTML = '<span class="is-live">●</span> live, refreshes every 20 s';
  }

  private showLegacy(show: boolean): void {
    this.root.hidden = show;
    for (const el of this.legacy) el.hidden = !show;
    if (show && !this.loading) this.status.textContent = '';
  }
}

function chip(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'surf-menu-chip';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}
