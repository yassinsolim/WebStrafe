import { describe, expect, it } from 'vitest';
import {
  HitmarkerFeedback,
  LETHAL_HEADSHOT_PHASE_MS,
  planHitConfirmation,
} from '../HitmarkerFeedback';

describe('HitmarkerFeedback', () => {
  it('expires each confirmation state at its deterministic boundary', () => {
    const feedback = new HitmarkerFeedback();
    const normal = feedback.trigger('normal', 100);
    expect(normal).toMatchObject({
      active: true,
      kind: 'normal',
      sequence: 1,
      chainCount: 1,
      expiresAtMs: 620,
      queuedKind: null,
      phaseEndsAtMs: 620,
    });
    expect(feedback.get(619).active).toBe(true);
    expect(feedback.get(620)).toMatchObject({ active: false, chainCount: 0 });

    expect(feedback.trigger('headshot', 300).expiresAtMs).toBe(920);
    expect(feedback.trigger('kill', 700).expiresAtMs).toBe(1420);
  });

  it('restarts rapid hits and caps stacking deterministically', () => {
    const feedback = new HitmarkerFeedback();
    expect(feedback.trigger('normal', 0)).toMatchObject({ sequence: 1, chainCount: 1 });
    expect(feedback.trigger('headshot', 50)).toMatchObject({
      kind: 'headshot',
      sequence: 2,
      chainCount: 2,
      expiresAtMs: 670,
    });
    expect(feedback.trigger('kill', 100)).toMatchObject({
      kind: 'kill',
      sequence: 3,
      chainCount: 3,
      expiresAtMs: 820,
    });
    expect(feedback.trigger('normal', 110)).toMatchObject({ sequence: 4, chainCount: 3 });
  });

  it('clears stale state while advancing the render sequence', () => {
    const feedback = new HitmarkerFeedback();
    feedback.trigger('headshot', 10);
    const cleared = feedback.clear();
    expect(cleared).toEqual({
      active: false,
      kind: 'normal',
      sequence: 2,
      chainCount: 0,
      expiresAtMs: 0,
      queuedKind: null,
      phaseEndsAtMs: 0,
    });
  });

  it('shows a lethal headshot diamond before a deterministic kill star', () => {
    const feedback = new HitmarkerFeedback();
    const start = feedback.trigger('lethal-headshot', 1_000);
    expect(start).toMatchObject({
      active: true,
      kind: 'headshot',
      sequence: 1,
      queuedKind: 'kill',
      phaseEndsAtMs: 1_000 + LETHAL_HEADSHOT_PHASE_MS,
      expiresAtMs: 1_000 + LETHAL_HEADSHOT_PHASE_MS + 720,
    });
    expect(feedback.get(1_000 + LETHAL_HEADSHOT_PHASE_MS - 1).kind).toBe('headshot');
    expect(feedback.get(1_000 + LETHAL_HEADSHOT_PHASE_MS)).toMatchObject({
      active: true,
      kind: 'kill',
      sequence: 2,
      queuedKind: null,
    });
    expect(feedback.get(1_000 + LETHAL_HEADSHOT_PHASE_MS + 719).active).toBe(true);
    expect(feedback.get(1_000 + LETHAL_HEADSHOT_PHASE_MS + 720).active).toBe(false);
  });

  it('restarts and replaces a queued lethal sequence without stale phases', () => {
    const feedback = new HitmarkerFeedback();
    feedback.trigger('lethal-headshot', 100);
    const bodyHit = feedback.trigger('normal', 150);
    expect(bodyHit).toMatchObject({
      kind: 'normal',
      sequence: 2,
      queuedKind: null,
      expiresAtMs: 670,
    });
    expect(feedback.get(669)).toMatchObject({ active: true, kind: 'normal' });
    expect(feedback.get(670)).toMatchObject({ active: false, kind: 'normal' });
  });

  it('plans one audio confirmation for each authoritative hit event', () => {
    expect(planHitConfirmation('body', false)).toEqual({
      visual: 'normal',
      audio: 'normal',
    });
    expect(planHitConfirmation('body', true)).toEqual({
      visual: 'kill',
      audio: 'kill',
    });
    expect(planHitConfirmation('head', true)).toEqual({
      visual: 'lethal-headshot',
      audio: 'headshot',
    });
  });
});
