import './surf.css';

/** bottom left pill: is this player fighting (pvp) or just surfing (peaceful) */
export class PvpBadge {
  readonly root: HTMLDivElement;
  private readonly label: HTMLSpanElement;
  private readonly hint: HTMLSpanElement;
  private key = '';

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'surf-pvp';
    this.root.hidden = true;
    const dot = document.createElement('span');
    dot.className = 'surf-pvp-dot';
    this.label = document.createElement('span');
    this.hint = document.createElement('span');
    this.hint.className = 'surf-pvp-hint';
    this.root.append(dot, this.label, this.hint);
    parent.appendChild(this.root);
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  /** locked: the map forces the mode (combat only maps) */
  render(pvp: boolean, locked: boolean): void {
    const key = `${pvp}|${locked}`;
    if (key === this.key) return;
    this.key = key;
    this.root.classList.toggle('is-on', pvp);
    this.root.classList.toggle('is-off', !pvp);
    this.label.textContent = pvp ? 'PvP on' : 'Peaceful';
    this.hint.textContent = locked ? 'combat map' : pvp ? 'P to surf in peace' : 'P to fight';
  }
}
