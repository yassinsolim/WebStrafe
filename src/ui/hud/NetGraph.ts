import { FrameStats } from './hudMath';

const REFRESH_MS = 250;

/** small fps, frame time and ping readout, refreshed four times a second */
export class NetGraph {
  readonly root: HTMLDivElement;
  private readonly fps: HTMLSpanElement;
  private readonly frame: HTMLSpanElement;
  private readonly ping: HTMLSpanElement;
  private readonly stats = new FrameStats(1000);
  private nextRefreshAt = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud-netgraph';
    this.root.hidden = true;
    this.fps = document.createElement('span');
    this.frame = document.createElement('span');
    this.ping = document.createElement('span');
    this.root.append(this.fps, this.frame, this.ping);
    parent.appendChild(this.root);
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
    if (!visible) {
      this.stats.clear();
    }
  }

  update(frameMs: number, nowMs: number, pingMs: number | null): void {
    if (this.root.hidden) {
      return;
    }
    this.stats.push(frameMs, nowMs);
    if (nowMs < this.nextRefreshAt) {
      return;
    }
    this.nextRefreshAt = nowMs + REFRESH_MS;
    const { fps, avgMs, maxMs } = this.stats.get();
    this.fps.textContent = `${Math.round(fps)} fps`;
    this.frame.textContent = `${avgMs.toFixed(1)} ms (max ${maxMs.toFixed(1)})`;
    this.ping.textContent = pingMs === null || !Number.isFinite(pingMs) ? 'ping --' : `ping ${Math.round(pingMs)} ms`;
    this.ping.dataset.level = pingMs === null ? 'none' : pingMs < 60 ? 'good' : pingMs < 120 ? 'ok' : 'bad';
  }
}
