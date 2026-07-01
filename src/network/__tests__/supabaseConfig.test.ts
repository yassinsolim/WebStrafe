import { afterEach, describe, expect, it } from 'vitest';
import { loadSupabaseConfig, resetSupabaseConfigCache } from '../supabaseConfig';

function fetchReturning(body: unknown, ok = true): typeof fetch {
  return (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
}

const NO_ENV = {} as const;

describe('loadSupabaseConfig', () => {
  afterEach(() => resetSupabaseConfigCache());

  it('prefers Vite env vars over the config file', async () => {
    const throwing = (async () => { throw new Error('file must not be fetched'); }) as unknown as typeof fetch;
    const config = await loadSupabaseConfig(throwing, {
      VITE_SUPABASE_URL: 'https://env.supabase.co',
      VITE_SUPABASE_KEY: 'envkey',
    });
    expect(config).toEqual({
      supabaseUrl: 'https://env.supabase.co',
      supabaseKey: 'envkey',
      leaderboardTable: 'webstrafe_leaderboard',
      lobbyChannelPrefix: 'webstrafe_room_v1',
    });
  });

  it('parses a complete config file and applies defaults', async () => {
    const config = await loadSupabaseConfig(
      fetchReturning({ supabaseUrl: 'https://x.supabase.co', supabaseKey: 'k' }),
      NO_ENV,
    );
    expect(config).toEqual({
      supabaseUrl: 'https://x.supabase.co',
      supabaseKey: 'k',
      leaderboardTable: 'webstrafe_leaderboard',
      lobbyChannelPrefix: 'webstrafe_room_v1',
    });
  });

  it('keeps explicit table/prefix overrides', async () => {
    const config = await loadSupabaseConfig(
      fetchReturning({ supabaseUrl: 'u', supabaseKey: 'k', leaderboardTable: 't', lobbyChannelPrefix: 'p' }),
      NO_ENV,
    );
    expect(config?.leaderboardTable).toBe('t');
    expect(config?.lobbyChannelPrefix).toBe('p');
  });

  it('returns null when the config is missing (404)', async () => {
    expect(await loadSupabaseConfig(fetchReturning({}, false), NO_ENV)).toBeNull();
  });

  it('returns null when required keys are absent', async () => {
    expect(await loadSupabaseConfig(fetchReturning({ supabaseUrl: 'u' }), NO_ENV)).toBeNull();
  });

  it('returns null when the fetch throws', async () => {
    const throwing = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(await loadSupabaseConfig(throwing, NO_ENV)).toBeNull();
  });

  it('caches the first result', async () => {
    const first = await loadSupabaseConfig(fetchReturning({ supabaseUrl: 'u', supabaseKey: 'k' }), NO_ENV);
    // A second call with a throwing fetch must still return the cached value.
    const throwing = (async () => { throw new Error('should not be called'); }) as unknown as typeof fetch;
    const second = await loadSupabaseConfig(throwing, NO_ENV);
    expect(second).toBe(first);
  });
});
