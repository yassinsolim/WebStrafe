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
