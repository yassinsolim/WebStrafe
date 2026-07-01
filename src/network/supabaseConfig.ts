export interface SupabaseConfig {
  supabaseUrl: string;
  supabaseKey: string;
  leaderboardTable: string;
  lobbyChannelPrefix: string;
}

const CONFIG_URL = '/config/webstrafe.config.json';
const DEFAULT_LEADERBOARD_TABLE = 'webstrafe_leaderboard';
const DEFAULT_LOBBY_PREFIX = 'webstrafe_room_v1';

let cached: SupabaseConfig | null | undefined;

/**
 * Loads the Supabase runtime config served at `/config/webstrafe.config.json`
 * (gitignored; holds the project URL + publishable key). Returns null when the
 * config is absent or incomplete — the game then runs offline/self-hosted
 * instead of on Supabase. Cached after the first call.
 */
export async function loadSupabaseConfig(
  fetchImpl: typeof fetch = fetch,
): Promise<SupabaseConfig | null> {
  if (cached !== undefined) {
    return cached;
  }
  cached = await fetchConfig(fetchImpl);
  return cached;
}

async function fetchConfig(fetchImpl: typeof fetch): Promise<SupabaseConfig | null> {
  try {
    const response = await fetchImpl(CONFIG_URL, { cache: 'no-store' });
    if (!response.ok) {
      return null;
    }
    const raw = (await response.json()) as Partial<SupabaseConfig>;
    if (!raw.supabaseUrl || !raw.supabaseKey) {
      return null;
    }
    return {
      supabaseUrl: raw.supabaseUrl,
      supabaseKey: raw.supabaseKey,
      leaderboardTable: raw.leaderboardTable ?? DEFAULT_LEADERBOARD_TABLE,
      lobbyChannelPrefix: raw.lobbyChannelPrefix ?? DEFAULT_LOBBY_PREFIX,
    };
  } catch {
    return null;
  }
}

/** Test-only: clears the memoized config. */
export function resetSupabaseConfigCache(): void {
  cached = undefined;
}
