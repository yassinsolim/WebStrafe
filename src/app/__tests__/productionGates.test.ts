import { afterEach, describe, expect, it, vi } from 'vitest';
import { devToolsEnabled } from '../devTools';
import { parseShotRequest } from '../shotMode';
import { qaRoomPrefix } from '../../network/createMultiplayer';
import { InputManager } from '../../core/InputManager';
import { parseDevCharacters, parseDevLook } from '../../characters/devCharacters';
import { defaultLook, encodeLook } from '../../characters/look';

// the env object a production build inlines (see the served bundle): no DEV, no VITE_DEV_TOOLS
const PRODUCTION_ENV = { BASE_URL: '/', DEV: false, MODE: 'production', PROD: true, SSR: false, VITE_ENABLE_COMBAT: 'true' };
const PREVIEW_ENV = { ...PRODUCTION_ENV, VITE_DEV_TOOLS: 'true' };

// every shot flag at once: qa hooks and window globals, teleport, free camera, no viewmodel, clock, perf
const EVERYTHING = '?shot=surf_lumen&qa=1&pos=0,50,0&cam=0,50,0&vm=0&time=12:00:00&perf=5&gripcheck=1&hudDemo=1&weapon=awp&quality=low&room=cheat';

function keydown(code: string): KeyboardEvent {
  return Object.assign(new Event('keydown', { cancelable: true }), { code, key: code, repeat: false }) as KeyboardEvent;
}

function input(debugKeys: boolean): InputManager {
  const canvas = Object.assign(new EventTarget(), { tagName: 'CANVAS' }) as unknown as HTMLElement;
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', Object.assign(new EventTarget(), { activeElement: canvas, pointerLockElement: canvas }));
  return new InputManager(canvas, { debugKeys });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a production build ignores dev and debug controls', () => {
  it('has dev tools off, preview builds on', () => {
    expect(devToolsEnabled(PRODUCTION_ENV)).toBe(false);
    expect(devToolsEnabled(PREVIEW_ENV)).toBe(true);
  });

  it('ignores every shot flag, so no qa hooks, window globals, teleport or free camera', () => {
    expect(parseShotRequest(EVERYTHING, devToolsEnabled(PRODUCTION_ENV))).toBeNull();
    const preview = parseShotRequest(EVERYTHING, devToolsEnabled(PREVIEW_ENV));
    expect(preview?.qa).toBe(true);
    expect(preview?.camera).toEqual([0, 50, 0]);
  });

  it('keeps everyone in the shared lobby, ?room= is preview only', () => {
    expect(qaRoomPrefix('webstrafe_room_v1', EVERYTHING, devToolsEnabled(PRODUCTION_ENV))).toBe('webstrafe_room_v1');
    expect(qaRoomPrefix('webstrafe_room_v1', EVERYTHING, devToolsEnabled(PREVIEW_ENV))).toBe('webstrafe_room_v1_qacheat');
  });

  it('ignores the character dev controls: ?chars= lineups, ?look=, ?chardetail= and the third person start', () => {
    const search = `?chars=6&charlook=max&chardist=3&chardetail=low&cam=third&look=${encodeLook(defaultLook('counterterrorist'))}`;
    expect(parseDevCharacters(search, devToolsEnabled(PRODUCTION_ENV))).toBeNull();
    expect(parseDevLook(search, 'terrorist', devToolsEnabled(PRODUCTION_ENV))).toBeNull();
    const preview = parseDevCharacters(search, devToolsEnabled(PREVIEW_ENV));
    expect(preview).toMatchObject({ count: 6, thirdPerson: true, detail: 'low' });
    expect(parseDevLook(search, 'terrorist', devToolsEnabled(PREVIEW_ENV))).toEqual(defaultLook('counterterrorist'));
  });

  it('never queues the V debug camera (third person, free camera)', () => {
    const prod = input(devToolsEnabled(PRODUCTION_ENV));
    window.dispatchEvent(keydown('KeyV'));
    expect(prod.consumeActions().toggleDebugCameraPressed).toBe(false);
    prod.dispose();

    const preview = input(devToolsEnabled(PREVIEW_ENV));
    window.dispatchEvent(keydown('KeyV'));
    expect(preview.consumeActions().toggleDebugCameraPressed).toBe(true);
    preview.dispose();
  });
});
