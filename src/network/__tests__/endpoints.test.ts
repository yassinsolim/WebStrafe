import { describe, expect, it } from 'vitest';
import { resolveApiBase, resolveWsUrl } from '../endpoints';

describe('resolveWsUrl', () => {
  it('uses VITE_WS_URL when set', () => {
    expect(resolveWsUrl({ VITE_WS_URL: 'wss://api.example.com/ws' }, { protocol: 'https:', host: 'x' }))
      .toBe('wss://api.example.com/ws');
  });

  it('falls back to same-origin wss on https', () => {
    expect(resolveWsUrl({}, { protocol: 'https:', host: 'strafe.yassin.app' }))
      .toBe('wss://strafe.yassin.app/ws');
  });

  it('falls back to same-origin ws on http', () => {
    expect(resolveWsUrl({}, { protocol: 'http:', host: 'localhost:5173' }))
      .toBe('ws://localhost:5173/ws');
  });
});

describe('resolveApiBase', () => {
  it('returns empty string (same origin) when unset', () => {
    expect(resolveApiBase({})).toBe('');
  });

  it('returns the configured base without a trailing slash', () => {
    expect(resolveApiBase({ VITE_API_BASE: 'https://api.example.com/' })).toBe('https://api.example.com');
    expect(resolveApiBase({ VITE_API_BASE: 'https://api.example.com' })).toBe('https://api.example.com');
  });
});

describe('pickTransport', () => {
  it('keeps supabase as the default when configured and lets previews force ws', async () => {
    const { pickTransport } = await import('../createMultiplayer');
    expect(pickTransport(undefined, true)).toBe('supabase');
    expect(pickTransport(undefined, false)).toBe('ws');
    expect(pickTransport('ws', true)).toBe('ws');
    expect(pickTransport('supabase', false)).toBe('ws');
    expect(pickTransport('nonsense', true)).toBe('supabase');
  });
});

describe('qaRoomPrefix', () => {
  it('only splits lobbies on dev and preview builds', async () => {
    const { qaRoomPrefix } = await import('../createMultiplayer');
    expect(qaRoomPrefix('webstrafe_room_v1', '?room=Surf-QA_42', true)).toBe('webstrafe_room_v1_qasurfqa42');
    expect(qaRoomPrefix('webstrafe_room_v1', '?room=Surf-QA_42', false)).toBe('webstrafe_room_v1');
    expect(qaRoomPrefix('webstrafe_room_v1', '?shot=x', true)).toBe('webstrafe_room_v1');
  });
});
