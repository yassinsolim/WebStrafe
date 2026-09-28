import { describe, expect, it } from 'vitest';
import { devToolsEnabled } from '../devTools';
import { parseShotRequest } from '../shotMode';

describe('shot mode gating', () => {
  it('is off in production builds', () => {
    expect(devToolsEnabled({ DEV: false, PROD: true })).toBe(false);
    expect(devToolsEnabled({ DEV: false, VITE_DEV_TOOLS: 'false' })).toBe(false);
    expect(parseShotRequest('?shot=aim_ochrecut&qa=1', false)).toBeNull();
    // a free camera or hidden viewmodel in live play would be a spectator cheat
    expect(parseShotRequest('?shot=aim_ochrecut&qa=1&vm=0&cam=0,50,0', false)).toBeNull();
  });

  it('is on for the dev server and preview builds', () => {
    expect(devToolsEnabled({ DEV: true })).toBe(true);
    expect(devToolsEnabled({ DEV: false, VITE_DEV_TOOLS: 'true' })).toBe(true);
    const shot = parseShotRequest('?shot=aim_ochrecut&qa=1&weapon=awp', true);
    expect(shot?.mapId).toBe('aim_ochrecut');
    expect(shot?.qa).toBe(true);
    expect(shot?.weapon).toBe('awp');
  });

  it('needs a map to do anything', () => {
    expect(parseShotRequest('?qa=1', true)).toBeNull();
  });

  it('reads the hud demo variant, off by default', () => {
    expect(parseShotRequest('?shot=aim_ochrecut', true)?.hudDemo).toBeNull();
    expect(parseShotRequest('?shot=aim_ochrecut&hudDemo=1', true)?.hudDemo).toBe('1');
    expect(parseShotRequest('?shot=aim_ochrecut&hudDemo=board', true)?.hudDemo).toBe('board');
    expect(parseShotRequest('?shot=aim_ochrecut&hudDemo=1', false)).toBeNull();
    expect(parseShotRequest('?shot=aim_ochrecut', true)?.viewmodel).toBe(true);
    expect(parseShotRequest('?shot=aim_ochrecut&vm=0', true)?.viewmodel).toBe(false);
    expect(parseShotRequest('?shot=aim_ochrecut&cam=1,2.5,-3', true)?.camera).toEqual([1, 2.5, -3]);
    expect(parseShotRequest('?shot=aim_ochrecut&cam=1,x', true)?.camera).toBeNull();
  });
});
