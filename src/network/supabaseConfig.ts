export interface SupabaseConfig {
  supabaseUrl: string;
  supabaseKey: string;
  leaderboardTable: string;
  lobbyChannelPrefix: string;
}

interface ConfigEnv {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_KEY?: string;
  VITE_SUPABASE_LEADERBOARD_TABLE?: string;
  VITE_SUPABASE_LOBBY_PREFIX?: string;
  [key: string]: unknown;
}

const CONFIG_URL = '/config/webstrafe.config.json';
const DEFAULT_LEADERBOARD_TABLE = 'webstrafe_leaderboard';
const DEFAULT_LOBBY_PREFIX = 'webstrafe_room_v1';

let cached: SupabaseConfig | null | undefined;

/**
 * Resolves the Supabase runtime config, preferring Vite build-time env vars
 * (VITE_SUPABASE_URL / VITE_SUPABASE_KEY — how the Vercel deploy provides them,
 * no file needed) and falling back to `/config/webstrafe.config.json` (the
 * gitignored local-dev file). Returns null when neither is present — the game
 * then runs offline/self-hosted. Cached after the first call.
 */
export async function loadSupabaseConfig(
  fetchImpl: typeof fetch = fetch,
  env: ConfigEnv = import.meta.env,
): Promise<SupabaseConfig | null> {
  if (cached !== undefined) {
    return cached;
  }
  cached = fromEnv(env) ?? (await fetchConfig(fetchImpl));
  return cached;
}

function fromEnv(env: ConfigEnv): SupabaseConfig | null {
  if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_KEY) {
    return null;
  }
  return {
    supabaseUrl: env.VITE_SUPABASE_URL,
    supabaseKey: env.VITE_SUPABASE_KEY,
    leaderboardTable: env.VITE_SUPABASE_LEADERBOARD_TABLE ?? DEFAULT_LEADERBOARD_TABLE,
    lobbyChannelPrefix: env.VITE_SUPABASE_LOBBY_PREFIX ?? DEFAULT_LOBBY_PREFIX,
  };
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
