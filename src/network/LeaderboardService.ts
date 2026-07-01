import type { LeaderboardEntry, PlayerModel } from './types';
import { resolveApiBase } from './endpoints';
import { loadSupabaseConfig } from './supabaseConfig';
import type { SupabaseLeaderboard } from './SupabaseLeaderboard';

export class LeaderboardService {
  private readonly apiBase = resolveApiBase(import.meta.env);
  private supabasePromise: Promise<SupabaseLeaderboard | null> | undefined;

  /** Lazily builds the Supabase-backed leaderboard, or null for the HTTP path. */
  private getSupabase(): Promise<SupabaseLeaderboard | null> {
    if (this.supabasePromise === undefined) {
      this.supabasePromise = (async () => {
        const config = await loadSupabaseConfig();
        if (!config) {
          return null;
        }
        try {
          const [{ createClient }, { SupabaseLeaderboard }] = await Promise.all([
            import('@supabase/supabase-js'),
            import('./SupabaseLeaderboard'),
          ]);
          return new SupabaseLeaderboard(
            createClient(config.supabaseUrl, config.supabaseKey),
            config.leaderboardTable,
          );
        } catch {
          return null;
        }
      })();
    }
    return this.supabasePromise;
  }

  public async fetchLeaderboard(mapId: string): Promise<LeaderboardEntry[]> {
    const supabase = await this.getSupabase();
    if (supabase) {
      return supabase.fetch(mapId);
    }
    const normalized = encodeURIComponent(mapId);
    const response = await fetch(`${this.apiBase}/api/leaderboard?mapId=${normalized}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Leaderboard fetch failed: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as { entries?: LeaderboardEntry[] };
    return payload.entries ?? [];
  }

  public async submitRun(
    mapId: string,
    name: string,
    timeMs: number,
    model: PlayerModel,
  ): Promise<LeaderboardEntry[]> {
    const supabase = await this.getSupabase();
    if (supabase) {
      return supabase.submit(mapId, name, timeMs, model);
    }
    const response = await fetch(`${this.apiBase}/api/leaderboard`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        mapId,
        name,
        timeMs,
        model,
      }),
    });

    if (!response.ok) {
      const detail = await this.readFailureMessage(response);
      throw new Error(`Leaderboard submit failed: ${response.status} ${response.statusText}${detail}`);
    }

    const payload = (await response.json()) as { entries?: LeaderboardEntry[] };
    return payload.entries ?? [];
  }

  private async readFailureMessage(response: Response): Promise<string> {
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) {
        return ` (${payload.error})`;
      }
    } catch {
      // ignored
    }
    return '';
  }
}

export function sanitizeLeaderboardName(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^A-Za-z0-9 _\-.]/g, '')
    .slice(0, 24);
}
