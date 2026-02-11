import type { LeaderboardEntry, PlayerModel } from './types';

export class LeaderboardService {
  public async fetchLeaderboard(mapId: string): Promise<LeaderboardEntry[]> {
    const normalized = encodeURIComponent(mapId);
    const response = await fetch(`/api/leaderboard?mapId=${normalized}`, {
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
    const response = await fetch('/api/leaderboard', {
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
