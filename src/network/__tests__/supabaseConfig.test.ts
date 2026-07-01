import { afterEach, describe, expect, it } from 'vitest';
import { loadSupabaseConfig, resetSupabaseConfigCache } from '../supabaseConfig';

function fetchReturning(body: unknown, ok = true): typeof fetch {
  return (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
}

describe('loadSupabaseConfig', () => {
  afterEach(() => resetSupabaseConfigCache());

  it('parses a complete config and applies defaults', async () => {
    const config = await loadSupabaseConfig(
      fetchReturning({ supabaseUrl: 'https://x.supabase.co', supabaseKey: 'k' }),
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
    );
    expect(config?.leaderboardTable).toBe('t');
    expect(config?.lobbyChannelPrefix).toBe('p');
  });

  it('returns null when the config is missing (404)', async () => {
    expect(await loadSupabaseConfig(fetchReturning({}, false))).toBeNull();
  });

  it('returns null when required keys are absent', async () => {
    expect(await loadSupabaseConfig(fetchReturning({ supabaseUrl: 'u' }))).toBeNull();
  });

  it('returns null when the fetch throws', async () => {
    const throwing = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(await loadSupabaseConfig(throwing)).toBeNull();
  });

  it('caches the first result', async () => {
    const first = await loadSupabaseConfig(fetchReturning({ supabaseUrl: 'u', supabaseKey: 'k' }));
    // A second call with a throwing fetch must still return the cached value.
    const throwing = (async () => { throw new Error('should not be called'); }) as unknown as typeof fetch;
    const second = await loadSupabaseConfig(throwing);
    expect(second).toBe(first);
  });
});
