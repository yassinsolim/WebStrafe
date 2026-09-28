import './surf.css';
import { formatRunTime } from '../hud/hudMath';
import { formatDelta } from '../../surf/splits';
import type { RunPhase } from '../../surf/RunTimer';

export interface RunTimerView {
  phase: RunPhase;
  timeMs: number;
  /** current stage (1 based) and how many the map has */
  stage: number;
  stageCount: number;
  pbMs: number | null;
  record: { name: string; timeMs: number } | null;
  unranked: string | null;
}

/** tick timer readout for trigger maps, replaces the plain run-timer label there */
export class RunTimerHud {
  readonly root: HTMLDivElement;
  private readonly time: HTMLDivElement;
  private readonly line: HTMLDivElement;
  private readonly split: HTMLDivElement;
  private readonly tag: HTMLDivElement;
  private splitHideAt = 0;
  private lastLine = '';

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'surf-timer';
    this.root.hidden = true;
    this.split = document.createElement('div');
    this.split.className = 'surf-timer-split';
    this.time = document.createElement('div');
    this.time.className = 'surf-timer-time';
    this.line = document.createElement('div');
    this.line.className = 'surf-timer-line';
    this.tag = document.createElement('div');
    this.tag.className = 'surf-timer-tag';
    this.tag.hidden = true;
    this.root.append(this.split, this.time, this.line, this.tag);
    parent.appendChild(this.root);
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  render(view: RunTimerView, nowMs: number): void {
    this.root.classList.toggle('is-ready', view.phase === 'ready' || view.phase === 'idle');
    this.root.classList.toggle('is-finished', view.phase === 'finished');
    this.time.textContent = view.phase === 'idle' ? '--' : formatRunTime(view.timeMs);
    const parts: string[] = [];
    if (view.stageCount > 1) parts.push(`Stage ${view.stage}/${view.stageCount}`);
    parts.push(view.pbMs !== null ? `PB ${formatRunTime(view.pbMs)}` : 'No PB yet');
    if (view.record) parts.push(`WR ${formatRunTime(view.record.timeMs)} ${view.record.name}`);
    if (view.phase === 'idle') parts.unshift('Enter the start zone');
    const line = parts.join('  ·  ');
    if (line !== this.lastLine) {
      this.line.textContent = line;
      this.lastLine = line;
    }
    this.tag.hidden = view.unranked === null;
    if (view.unranked !== null) this.tag.textContent = `unranked: ${view.unranked}`;
    if (this.splitHideAt > 0 && nowMs > this.splitHideAt) {
      this.split.classList.remove('is-shown');
      this.splitHideAt = 0;
    }
  }

  /** checkpoint popup: the split time and how it compares to the pb */
  flashSplit(label: string, timeMs: number, deltaMs: number | null, nowMs: number): void {
    this.split.replaceChildren();
    const text = document.createElement('span');
    text.textContent = `${label}  ${formatRunTime(timeMs)}`;
    this.split.appendChild(text);
    if (deltaMs !== null) {
      const delta = document.createElement('span');
      delta.className = deltaMs <= 0 ? 'is-ahead' : 'is-behind';
      delta.textContent = `  ${formatDelta(deltaMs)}`;
      this.split.appendChild(delta);
    }
    this.split.classList.add('is-shown');
    this.splitHideAt = nowMs + 2200;
  }
}
