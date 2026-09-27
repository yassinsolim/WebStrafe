import type { ZoomLevel } from '../combat/Scope';

const STYLE_ID = 'ws-scope-style';

// original design: black mask around one round lens, a faint vignette and
// glint inside it, thin crossing lines with heavier outer posts and a few
// small range ticks. sized in vmin so the lens always fits the screen.
const STYLE = `
.ws-scope {
  --ws-lens: 46vmin;
  position: fixed;
  inset: 0;
  z-index: 15;
  pointer-events: none;
  display: none;
  background:
    radial-gradient(circle var(--ws-lens) at 44% 40%, rgba(150, 190, 220, 0.05), rgba(0, 0, 0, 0) 55%),
    radial-gradient(circle var(--ws-lens) at 50% 50%,
      rgba(0, 0, 0, 0) 58%,
      rgba(3, 5, 7, 0.22) 84%,
      rgba(2, 3, 4, 0.7) 97%,
      #000 99.6%);
}
.ws-scope.is-visible { display: block; }
.ws-scope-lens {
  position: absolute;
  left: 50%;
  top: 50%;
  width: calc(var(--ws-lens) * 2);
  height: calc(var(--ws-lens) * 2);
  transform: translate(-50%, -50%);
  border-radius: 50%;
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.95), inset 0 0 0 1px rgba(255, 255, 255, 0.06);
  overflow: hidden;
}
.ws-scope-line {
  position: absolute;
  background: rgba(4, 6, 8, 0.92);
}
.ws-scope-line.is-h { left: 0; right: 0; top: 50%; height: 1px; margin-top: -0.5px; }
.ws-scope-line.is-v { top: 0; bottom: 0; left: 50%; width: 1px; margin-left: -0.5px; }
.ws-scope-post { position: absolute; background: rgba(4, 6, 8, 0.95); }
.ws-scope-post.is-left { left: 0; width: 36%; top: 50%; height: 3px; margin-top: -1.5px; }
.ws-scope-post.is-right { right: 0; width: 36%; top: 50%; height: 3px; margin-top: -1.5px; }
.ws-scope-post.is-bottom { bottom: 0; height: 36%; left: 50%; width: 3px; margin-left: -1.5px; }
.ws-scope-tick { position: absolute; background: rgba(4, 6, 8, 0.85); }
.ws-scope-tick.is-h { width: 1px; height: 7px; top: 50%; margin-top: -3.5px; }
.ws-scope-tick.is-v { height: 1px; width: 7px; left: 50%; margin-left: -3.5px; }
.ws-scope.is-zoom-2 .ws-scope-line { background: rgba(4, 6, 8, 0.98); }
`;

/**
 * AWP scope overlay drawn in the DOM above the world and below the HUD.
 * GameApp shows it while scoped; ScopeState owns the zoom logic.
 */
export class ScopeOverlay {
  private readonly root: HTMLDivElement;
  private visible = false;
  private level: ZoomLevel = 0;

  constructor(container: HTMLElement) {
    ensureStyle();
    this.root = document.createElement('div');
    this.root.className = 'ws-scope';
    this.root.setAttribute('aria-hidden', 'true');

    const lens = document.createElement('div');
    lens.className = 'ws-scope-lens';
    for (const cls of ['ws-scope-line is-h', 'ws-scope-line is-v', 'ws-scope-post is-left', 'ws-scope-post is-right', 'ws-scope-post is-bottom']) {
      lens.appendChild(part(cls));
    }
    // small range ticks on the thin lines, both sides of the centre
    for (const offset of [-24, -12, 12, 24]) {
      const onH = part('ws-scope-tick is-h');
      onH.style.left = `${50 + offset}%`;
      lens.appendChild(onH);
      if (offset > 0) {
        const onV = part('ws-scope-tick is-v');
        onV.style.top = `${50 + offset}%`;
        lens.appendChild(onV);
      }
    }
    this.root.appendChild(lens);
    container.appendChild(this.root);
  }

  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    this.root.classList.toggle('is-visible', visible);
  }

  setZoomLevel(level: ZoomLevel): void {
    if (level === this.level) return;
    this.level = level;
    this.root.classList.toggle('is-zoom-2', level === 2);
  }

  dispose(): void {
    this.root.remove();
  }
}

function part(className: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = className;
  return el;
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE;
  document.head.appendChild(style);
}
