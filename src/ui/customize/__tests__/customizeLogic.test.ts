import { describe, expect, it } from 'vitest';
import { ARMOR_SLOTS } from '../../../characters/catalog';
import { defaultLook, type CharacterLook } from '../../../characters/look';
import {
  FOCUS_SHOTS,
  LookHistory,
  ORBIT_LIMITS,
  applyPreset,
  clampView,
  damp,
  dampView,
  fitDistance,
  focusView,
  nearestAngle,
  nextSavedName,
  orbitByDrag,
  panByDrag,
  parseHexInput,
  pinchView,
  refitView,
  sameStyle,
  stepSpin,
  swatchName,
  viewCameraPosition,
  viewsSettled,
  wheelZoomFactor,
  zoomView,
  type OrbitView,
  type ViewFocus,
} from '../customizeLogic';

const FOV = 30;
const base: OrbitView = { yaw: 0, pitch: 0.1, distance: 3, targetY: 1 };
const FOCUSES: ViewFocus[] = ['full', ...ARMOR_SLOTS];

describe('orbit clamps', () => {
  it('pulls distance, target height and pitch back inside the limits', () => {
    const view = clampView({ yaw: 0, pitch: 5, distance: 100, targetY: 9 });
    expect(view.distance).toBe(ORBIT_LIMITS.maxDistance);
    expect(view.targetY).toBe(ORBIT_LIMITS.maxTargetY);
    expect(view.pitch).toBe(ORBIT_LIMITS.maxPitch);
    const close = clampView({ yaw: 0, pitch: -5, distance: 0.01, targetY: -3 });
    expect(close.distance).toBe(ORBIT_LIMITS.minDistance);
    expect(close.targetY).toBe(ORBIT_LIMITS.minTargetY);
    expect(close.pitch).toBeGreaterThanOrEqual(ORBIT_LIMITS.minPitch);
  });

  it('leaves yaw unbounded', () => {
    expect(clampView({ ...base, yaw: 40 }).yaw).toBe(40);
    let view = base;
    for (let i = 0; i < 50; i += 1) view = orbitByDrag(view, 200, 0);
    expect(view.yaw).toBeLessThan(-Math.PI * 4);
  });

  it('never lets the camera dip under the floor', () => {
    for (let targetY = 0.2; targetY <= 1.75; targetY += 0.15) {
      for (let distance = 0.6; distance <= 7; distance += 0.4) {
        const view = clampView({ yaw: 1, pitch: -1, distance, targetY });
        expect(viewCameraPosition(view).y).toBeGreaterThanOrEqual(ORBIT_LIMITS.minCameraY - 1e-9);
      }
    }
  });
});

describe('orbit input', () => {
  it('drag right turns the camera the way you would spin the model, drag down raises it', () => {
    const view = orbitByDrag(base, 40, 30);
    expect(view.yaw).toBeLessThan(base.yaw);
    expect(view.pitch).toBeGreaterThan(base.pitch);
    expect(orbitByDrag(base, 0, 10_000).pitch).toBe(ORBIT_LIMITS.maxPitch);
    expect(orbitByDrag(base, 0, -10_000).pitch).toBeGreaterThanOrEqual(ORBIT_LIMITS.minPitch);
  });

  it('wheel down zooms out, wheel up zooms in, one notch is a modest step', () => {
    expect(wheelZoomFactor(100)).toBeGreaterThan(1);
    expect(wheelZoomFactor(-100)).toBeLessThan(1);
    expect(wheelZoomFactor(100)).toBeLessThan(1.3);
    // line mode and trackpad pinches get scaled up to something useful
    expect(wheelZoomFactor(3, 1)).toBeGreaterThan(wheelZoomFactor(3, 0));
    expect(wheelZoomFactor(4, 0, true)).toBeGreaterThan(wheelZoomFactor(4, 0, false));
    // a huge flick is capped
    expect(wheelZoomFactor(1e6)).toBeCloseTo(Math.exp(0.5), 9);
  });

  it('zoom and pinch stay inside the distance limits', () => {
    expect(zoomView(base, 100).distance).toBe(ORBIT_LIMITS.maxDistance);
    expect(zoomView(base, 0.001).distance).toBe(ORBIT_LIMITS.minDistance);
    expect(pinchView(base, 100, 200).distance).toBeCloseTo(1.5, 9);
    expect(pinchView(base, 200, 100).distance).toBeCloseTo(6, 9);
    expect(pinchView(base, 0, 100)).toEqual(clampView(base));
  });

  it('pan moves the target by what the frame shows', () => {
    // 3 m away with a 30 degree fov the frame is 2 * 3 * tan(15) tall
    const frame = 2 * 3 * Math.tan(Math.PI / 12);
    const view = panByDrag(base, 100, 1000, FOV);
    expect(view.targetY - base.targetY).toBeCloseTo(frame / 10, 9);
    expect(panByDrag(base, 1e6, 1000, FOV).targetY).toBe(ORBIT_LIMITS.maxTargetY);
  });
});

describe('damping', () => {
  it('does not depend on the frame rate', () => {
    let fine = 0;
    for (let i = 0; i < 10; i += 1) fine = damp(fine, 1, 9, 0.01);
    expect(damp(0, 1, 9, 0.1)).toBeCloseTo(fine, 12);
  });

  it('moves towards the goal without overshooting and settles', () => {
    const goal: OrbitView = { yaw: 2, pitch: 0.4, distance: 1.2, targetY: 1.6 };
    let view = base;
    let last = Infinity;
    for (let i = 0; i < 120; i += 1) {
      view = dampView(view, goal, 1 / 60);
      const gap = Math.abs(goal.yaw - view.yaw);
      expect(gap).toBeLessThanOrEqual(last);
      expect(view.yaw).toBeLessThanOrEqual(goal.yaw);
      last = gap;
    }
    expect(viewsSettled(view, goal)).toBe(true);
    expect(viewsSettled(base, goal)).toBe(false);
    expect(dampView(base, goal, 0)).toEqual(base);
  });

  it('flicked spins slow down the same way at any frame rate and then stop', () => {
    const once = stepSpin(4, 0.5);
    let velocity = 4;
    let total = 0;
    for (let i = 0; i < 50; i += 1) {
      const step = stepSpin(velocity, 0.01);
      total += step.delta;
      velocity = step.velocity;
    }
    expect(total).toBeCloseTo(once.delta, 9);
    expect(velocity).toBeCloseTo(once.velocity, 9);
    expect(Math.abs(once.velocity)).toBeLessThan(4);
    expect(stepSpin(0.01, 0.016)).toEqual({ delta: 0, velocity: 0 });
    expect(stepSpin(2, 0)).toEqual({ delta: 0, velocity: 2 });
  });

  it('nearestAngle picks the closest whole turn', () => {
    const turn = Math.PI * 2;
    expect(nearestAngle(0, 0.5)).toBeCloseTo(0.5, 12);
    expect(nearestAngle(3 * turn, 0.5)).toBeCloseTo(3 * turn + 0.5, 12);
    expect(nearestAngle(-2 * turn + 0.2, 0.5)).toBeCloseTo(-2 * turn + 0.5, 12);
    expect(Math.abs(nearestAngle(10, -2.5) - 10)).toBeLessThanOrEqual(Math.PI);
  });

  it('places the camera on +z at yaw 0 and on +x at a quarter turn', () => {
    const front = viewCameraPosition({ yaw: 0, pitch: 0, distance: 2, targetY: 1 });
    expect(front.x).toBeCloseTo(0, 12);
    expect(front.y).toBeCloseTo(1, 12);
    expect(front.z).toBeCloseTo(2, 12);
    const side = viewCameraPosition({ yaw: Math.PI / 2, pitch: Math.PI / 6, distance: 2, targetY: 1 });
    expect(side.x).toBeCloseTo(Math.sqrt(3), 12);
    expect(side.y).toBeCloseTo(2, 12);
    expect(side.z).toBeCloseTo(0, 12);
  });
});

describe('slot focus', () => {
  it('gives every focus a view inside the limits with the camera above the floor', () => {
    for (const focus of FOCUSES) {
      for (const aspect of [0.6, 1, 16 / 9, 2.6]) {
        const view = focusView(focus, aspect, FOV);
        expect(view).toEqual(clampView(view));
        expect(viewCameraPosition(view).y).toBeGreaterThan(ORBIT_LIMITS.minCameraY);
      }
    }
  });

  it('frames each area where it is on a 1.8 m character', () => {
    const view = (focus: ViewFocus) => focusView(focus, 1.2, FOV);
    expect(view('helmet').targetY).toBeGreaterThan(1.5);
    expect(view('legs').targetY).toBeLessThan(0.7);
    expect(view('chest').targetY).toBeGreaterThan(view('legs').targetY);
    expect(view('helmet').distance).toBeLessThan(view('chest').distance);
    expect(view('chest').distance).toBeLessThan(view('full').distance);
    // the full shot shows all of the character with room to spare
    const full = FOCUS_SHOTS.full;
    expect(full.targetY + full.frameHeight / 2).toBeGreaterThan(1.9);
    expect(full.targetY - full.frameHeight / 2).toBeLessThan(0);
  });

  it('looks at the class item from behind and at the rest from the front', () => {
    expect(viewCameraPosition(focusView('classItem', 1.2, FOV)).z).toBeLessThan(0);
    for (const focus of ['full', 'helmet', 'arms', 'chest', 'legs'] as const) {
      expect(viewCameraPosition(focusView(focus, 1.2, FOV)).z).toBeGreaterThan(0);
    }
  });

  it('does not unwind a camera the player already spun around', () => {
    const spun = 6 * Math.PI + 0.3;
    const view = focusView('chest', 1.2, FOV, spun);
    expect(Math.abs(view.yaw - spun)).toBeLessThanOrEqual(Math.PI);
    expect(Math.cos(view.yaw)).toBeCloseTo(Math.cos(FOCUS_SHOTS.chest.yaw), 9);
  });

  it('backs off for narrow stages and keeps the player zoom on resize', () => {
    expect(fitDistance(1, 1, 0.5, FOV)).toBeGreaterThan(fitDistance(1, 1, 1.5, FOV));
    const wide = focusView('full', 1.6, FOV);
    const zoomed = { ...wide, distance: wide.distance * 0.8 };
    const refit = refitView(zoomed, 'full', 1.6, 0.5, FOV);
    const narrow = focusView('full', 0.5, FOV);
    expect(refit.distance / narrow.distance).toBeCloseTo(0.8, 6);
    expect(refit.yaw).toBe(zoomed.yaw);
  });
});

describe('LookHistory', () => {
  const look = (patch: Partial<CharacterLook>): CharacterLook => ({ ...defaultLook(), ...patch });

  it('undoes and redoes whole looks and ignores edits that change nothing', () => {
    const history = new LookHistory(look({}));
    expect(history.canUndo).toBe(false);
    expect(history.record(look({}))).toBe(false);
    expect(history.record(look({ helmet: 'anvil' }))).toBe(true);
    expect(history.record(look({ helmet: 'anvil', legs: 'quill' }))).toBe(true);
    expect(history.undo()?.legs).toBe('strafe');
    expect(history.undo()?.helmet).toBe('strafe');
    expect(history.undo()).toBeNull();
    expect(history.redo()?.helmet).toBe('anvil');
    expect(history.canRedo).toBe(true);
    // a new edit drops the redo tail
    history.record(look({ helmet: 'anvil', emblem: 'star' }));
    expect(history.canRedo).toBe(false);
    expect(history.redo()).toBeNull();
    expect(history.current.emblem).toBe('star');
  });

  it('folds a colour drag into one step and splits it on endGroup', () => {
    const history = new LookHistory(look({}));
    history.record(look({ primary: '#111111' }), 'primary');
    history.record(look({ primary: '#222222' }), 'primary');
    history.record(look({ primary: '#333333' }), 'primary');
    history.endGroup();
    history.record(look({ primary: '#444444' }), 'primary');
    expect(history.undo()?.primary).toBe('#333333');
    expect(history.undo()?.primary).toBe(defaultLook().primary);
    expect(history.canUndo).toBe(false);
  });

  it('drops a drag that ends where it started', () => {
    const history = new LookHistory(look({}));
    history.record(look({ accent: '#123456' }), 'accent');
    history.record(look({}), 'accent');
    expect(history.canUndo).toBe(false);
    expect(history.current).toEqual(look({}));
  });

  it('keeps at most `limit` steps and hands out copies', () => {
    const history = new LookHistory(look({}), 5);
    for (let i = 0; i < 12; i += 1) history.record(look({ tag: `T${i}` }));
    let undos = 0;
    while (history.undo()) undos += 1;
    expect(undos).toBe(4);
    expect(history.current.tag).toBe('T7');
    history.current.tag = 'CHANGED';
    expect(history.current.tag).toBe('T7');
    history.reset(look({ tag: 'NEW' }));
    expect(history.canUndo || history.canRedo).toBe(false);
    expect(history.current.tag).toBe('NEW');
  });
});

describe('look helpers', () => {
  const mine = { ...defaultLook(), tag: 'ACE', watch: false };
  const preset = { ...defaultLook('counterterrorist'), helmet: 'quill' as const, tag: '', watch: true };

  it('built-in presets keep the player tag and watch, saved looks restore them', () => {
    expect(applyPreset(mine, preset, true)).toEqual({ ...preset, tag: 'ACE', watch: false });
    expect(applyPreset(mine, preset, false)).toEqual(preset);
  });

  it('sameStyle ignores the tag and the watch only', () => {
    expect(sameStyle(mine, { ...mine, tag: 'OTHER', watch: true })).toBe(true);
    expect(sameStyle(mine, { ...mine, finish: 'gloss' })).toBe(false);
  });

  it('parses the hex formats people type', () => {
    expect(parseHexInput('#A4502A')).toBe('#a4502a');
    expect(parseHexInput(' a4502a ')).toBe('#a4502a');
    expect(parseHexInput('#f80')).toBe('#ff8800');
    expect(parseHexInput('f80')).toBe('#ff8800');
    for (const bad of ['', '#', '#12345', '#1234567', 'orange', '#gg0000']) {
      expect(parseHexInput(bad)).toBeNull();
    }
  });

  it('names palette colours and leaves custom ones unnamed', () => {
    expect(swatchName('#C2A67A')).toBe('Sand');
    expect(swatchName('#123456')).toBeNull();
  });

  it('suggests the first free Look N name', () => {
    expect(nextSavedName([])).toBe('Look 1');
    expect(nextSavedName(['Look 1', 'look 2', 'Night'])).toBe('Look 3');
  });
});
