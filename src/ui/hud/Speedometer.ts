import {
  formatSignedUnits,
  speedTrend,
  toStrafeStatsView,
  toUnitsPerSecond,
  type SpeedTrend,
  type StrafeStatsInput,
} from './speedometerLogic';

/**
 * Bottom centre speed readout in units per second. Green when faster than the
 * last takeoff, red when slower. The strafe line (takeoff, gain, sync, jumps)
 * shows whatever stats are provided and hides the rest.
 */
export class Speedometer {
  readonly root: HTMLDivElement;
  private readonly value: HTMLDivElement;
  private readonly strafe: HTMLDivElement;
  private readonly takeoff: HTMLSpanElement;
  private readonly gain: HTMLSpanElement;
  private readonly sync: HTMLSpanElement;
  private readonly jumps: HTMLSpanElement;
  private lastUps = -1;
  private lastTrend: SpeedTrend | null = null;
  private lastStrafeKey = '';
  private showStrafe = true;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud-speed';
    const line = document.createElement('div');
    line.className = 'hud-speed-line';
    this.value = document.createElement('div');
    this.value.className = 'hud-speed-value';
    this.value.textContent = '0';
    const unit = document.createElement('div');
    unit.className = 'hud-speed-unit';
    unit.textContent = 'u/s';
    line.append(this.value, unit);
    this.strafe = document.createElement('div');
    this.strafe.className = 'hud-strafe';
    this.takeoff = stat('takeoff');
    this.gain = stat('gain');
    this.sync = stat('sync');
    this.jumps = stat('jumps');
    this.strafe.append(this.takeoff, this.gain, this.sync, this.jumps);
    this.root.append(line, this.strafe);
    parent.appendChild(this.root);
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  setStrafeStatsVisible(visible: boolean): void {
    this.showStrafe = visible;
    this.lastStrafeKey = '';
  }

  /** speed in m/s, stats in m/s (see StrafeStatsInput) */
  update(speedMps: number, stats: StrafeStatsInput | null): void {
    const ups = toUnitsPerSecond(speedMps);
    const view = stats ? toStrafeStatsView(stats) : null;
    const trend = speedTrend(ups, view ? view.takeoffUps : null);
    if (ups !== this.lastUps) {
      this.lastUps = ups;
      this.value.textContent = String(ups);
    }
    if (trend !== this.lastTrend) {
      this.lastTrend = trend;
      this.value.dataset.trend = trend;
    }

    const key = !this.showStrafe || !view
      ? 'none'
      : `${view.takeoffUps}|${view.gainUps}|${view.syncPercent}|${view.jumpCount}`;
    if (key === this.lastStrafeKey) {
      return;
    }
    this.lastStrafeKey = key;
    if (key === 'none' || !view) {
      this.strafe.hidden = true;
      return;
    }
    this.strafe.hidden = false;
    setStat(this.takeoff, String(view.takeoffUps));
    setStat(this.gain, view.gainUps === null ? null : formatSignedUnits(view.gainUps));
    this.gain.dataset.trend = view.gainUps === null ? 'neutral' : view.gainUps > 0 ? 'gain' : view.gainUps < 0 ? 'loss' : 'neutral';
    setStat(this.sync, view.syncPercent === null ? null : `${view.syncPercent}%`);
    setStat(this.jumps, view.jumpCount === null ? null : String(view.jumpCount));
  }
}

function stat(label: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = 'hud-strafe-stat';
  const value = document.createElement('b');
  const caption = document.createElement('i');
  caption.textContent = label;
  el.append(value, caption);
  return el;
}

function setStat(el: HTMLSpanElement, value: string | null): void {
  el.hidden = value === null;
  if (value !== null) {
    (el.firstElementChild as HTMLElement).textContent = value;
  }
}
