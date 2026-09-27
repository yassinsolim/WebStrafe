import { describe, expect, it } from 'vitest';
import { AWP_SCOPE, ScopeState, zoomedFovDeg, type ScopeContext } from '../Scope';

const ready: ScopeContext = { awpHeld: true, reloading: false, alive: true };
const BOLT_MS = 1500;

describe('zoomedFovDeg', () => {
  it('reproduces cs fovs at a 90 degree base', () => {
    expect(zoomedFovDeg(90, 0)).toBe(90);
    expect(zoomedFovDeg(90, 1)).toBeCloseTo(40, 9);
    expect(zoomedFovDeg(90, 2)).toBeCloseTo(10, 9);
  });

  it('keeps the cs magnification for other world fovs', () => {
    const magnification = (base: number, level: 1 | 2) =>
      Math.tan(((base / 2) * Math.PI) / 180) / Math.tan(((zoomedFovDeg(base, level) / 2) * Math.PI) / 180);
    expect(magnification(100, 1)).toBeCloseTo(magnification(90, 1), 9);
    expect(magnification(100, 2)).toBeCloseTo(magnification(90, 2), 9);
    expect(magnification(90, 1)).toBeCloseTo(2.747, 3);
    expect(magnification(90, 2)).toBeCloseTo(11.43, 2);
  });
});

describe('ScopeState', () => {
  it('cycles unscoped, zoom 1, zoom 2, unscoped', () => {
    const scope = new ScopeState();
    expect(scope.getLevel()).toBe(0);
    expect(scope.cycle(0, ready)).toBe(true);
    expect(scope.getLevel()).toBe(1);
    scope.cycle(10, ready);
    expect(scope.getLevel()).toBe(2);
    scope.cycle(20, ready);
    expect(scope.getLevel()).toBe(0);
    expect(scope.isScoped()).toBe(false);
  });

  it('refuses to zoom without the awp, while reloading or dead', () => {
    const scope = new ScopeState();
    expect(scope.cycle(0, { ...ready, awpHeld: false })).toBe(false);
    expect(scope.cycle(0, { ...ready, reloading: true })).toBe(false);
    expect(scope.cycle(0, { ...ready, alive: false })).toBe(false);
    expect(scope.getLevel()).toBe(0);
  });

  it('unscopes on fire and re-scopes to the same zoom after the bolt', () => {
    const scope = new ScopeState();
    scope.cycle(0, ready);
    scope.cycle(0, ready);
    scope.onShot(1000, BOLT_MS);
    expect(scope.getLevel()).toBe(0);
    // the zoom is locked while the bolt cycles
    expect(scope.cycle(1200, ready)).toBe(false);
    scope.update(1000 + BOLT_MS - 1, ready);
    expect(scope.getLevel()).toBe(0);
    scope.update(1000 + BOLT_MS, ready);
    expect(scope.getLevel()).toBe(2);
  });

  it('does not re-scope after a no-scope, a reload, a switch or death', () => {
    const noScope = new ScopeState();
    noScope.onShot(0, BOLT_MS);
    noScope.update(BOLT_MS, ready);
    expect(noScope.getLevel()).toBe(0);

    const reloaded = new ScopeState();
    reloaded.cycle(0, ready);
    reloaded.onShot(100, BOLT_MS);
    reloaded.update(100 + BOLT_MS, { ...ready, reloading: true });
    expect(reloaded.getLevel()).toBe(0);

    const cancelled = new ScopeState();
    cancelled.cycle(0, ready);
    cancelled.onShot(100, BOLT_MS);
    cancelled.cancel(500);
    cancelled.update(100 + BOLT_MS, ready);
    expect(cancelled.getLevel()).toBe(0);

    const switched = new ScopeState();
    switched.cycle(0, ready);
    switched.onShot(100, BOLT_MS);
    switched.update(100 + BOLT_MS, { ...ready, awpHeld: false });
    expect(switched.getLevel()).toBe(0);
  });

  it('eases the fov over the cs zoom time and snaps back on cancel', () => {
    const scope = new ScopeState();
    scope.cycle(1000, ready);
    const zoomMs = AWP_SCOPE.zoomTimeSec * 1000;
    expect(scope.getFovDeg(90, 1000)).toBeCloseTo(90, 9);
    expect(scope.getFovDeg(90, 1000 + zoomMs / 2)).toBeCloseTo(65, 9);
    expect(scope.getFovDeg(90, 1000 + zoomMs)).toBeCloseTo(40, 9);
    scope.cancel(2000);
    expect(scope.getFovDeg(90, 2000 + zoomMs)).toBe(90);
  });

  it('scales mouse sensitivity by fov ratio times the zoom ratio', () => {
    const scope = new ScopeState();
    expect(scope.getSensitivityScale(90)).toBe(1);
    scope.cycle(0, ready);
    expect(scope.getSensitivityScale(90)).toBeCloseTo(40 / 90, 9);
    expect(scope.getSensitivityScale(90, 1.5)).toBeCloseTo((40 / 90) * 1.5, 9);
    scope.cycle(0, ready);
    expect(scope.getSensitivityScale(90)).toBeCloseTo(10 / 90, 9);
    expect(scope.getSensitivityScale(100)).toBeCloseTo(zoomedFovDeg(100, 2) / 100, 9);
  });
});
