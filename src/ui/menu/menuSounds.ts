import { getAudioEngine, type AudioEngine } from '../../audio/AudioEngine';

const INTERACTIVE = 'button:not(:disabled), [data-sfx], input[type="checkbox"], input[type="range"], .menu-tab';

/**
 * Hover and click sounds for every interactive element under `root`, through
 * event delegation so panels do not need to wire anything. Elements can opt
 * into the confirm sound with data-sfx="confirm" or out with data-sfx="none".
 */
export function attachMenuSounds(root: HTMLElement, engine: AudioEngine = getAudioEngine()): () => void {
  let hovered: Element | null = null;

  const onOver = (event: PointerEvent): void => {
    const target = (event.target as Element | null)?.closest?.(INTERACTIVE) ?? null;
    if (target === hovered) {
      return;
    }
    hovered = target;
    if (target && root.contains(target) && (target as HTMLElement).dataset.sfx !== 'none') {
      engine.play('uiHover');
    }
  };

  const onClick = (event: MouseEvent): void => {
    const target = (event.target as Element | null)?.closest?.(INTERACTIVE) as HTMLElement | null;
    if (!target || !root.contains(target) || target.dataset.sfx === 'none') {
      return;
    }
    if (target instanceof HTMLInputElement && target.type === 'range') {
      return;
    }
    engine.play(target.dataset.sfx === 'confirm' ? 'uiConfirm' : 'uiClick');
  };

  const onChange = (event: Event): void => {
    if (event.target instanceof HTMLInputElement && event.target.type === 'range') {
      engine.play('uiClick', { volume: 0.6 });
    }
  };

  root.addEventListener('pointerover', onOver);
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  return () => {
    root.removeEventListener('pointerover', onOver);
    root.removeEventListener('click', onClick);
    root.removeEventListener('change', onChange);
  };
}
