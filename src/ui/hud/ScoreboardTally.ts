export interface ScoreboardPlayer {
  id: string;
  name: string;
  alive?: boolean;
}

export interface ScoreboardRow {
  id: string;
  name: string;
  kills: number;
  deaths: number;
  isLocal: boolean;
  isBot: boolean;
  alive: boolean;
  pingMs: number | null;
}

interface Score {
  kills: number;
  deaths: number;
}

export function isBotId(id: string): boolean {
  return id.startsWith('bot:') || id.startsWith('bot_') || id.startsWith('bot-');
}

/**
 * Kills and deaths counted on this client from death events since joining.
 * The server keeps no score, so a rejoin (map change) starts from zero.
 */
export class ScoreboardTally {
  private readonly scores = new Map<string, Score>();

  recordDeath(event: { killerId: string; victimId: string }): void {
    if (event.victimId) {
      this.score(event.victimId).deaths += 1;
    }
    if (event.killerId && event.killerId !== event.victimId) {
      this.score(event.killerId).kills += 1;
    }
  }

  getScore(id: string): Score {
    const score = this.scores.get(id);
    return score ? { ...score } : { kills: 0, deaths: 0 };
  }

  reset(): void {
    this.scores.clear();
  }

  /**
   * Rows for everyone currently in the snapshot, best first. Only the local
   * ping is known on the client.
   */
  rows(players: readonly ScoreboardPlayer[], localId: string | null, localPingMs: number | null = null): ScoreboardRow[] {
    const seen = new Set<string>();
    const rows: ScoreboardRow[] = [];
    for (const player of players) {
      if (seen.has(player.id)) {
        continue;
      }
      seen.add(player.id);
      const score = this.getScore(player.id);
      const isLocal = player.id === localId;
      rows.push({
        id: player.id,
        name: player.name,
        kills: score.kills,
        deaths: score.deaths,
        isLocal,
        isBot: isBotId(player.id),
        alive: player.alive !== false,
        pingMs: isLocal && localPingMs !== null && Number.isFinite(localPingMs) ? Math.round(localPingMs) : null,
      });
    }
    return rows.sort((a, b) =>
      b.kills - a.kills
      || a.deaths - b.deaths
      || Number(b.isLocal) - Number(a.isLocal)
      || a.name.localeCompare(b.name));
  }

  private score(id: string): Score {
    let score = this.scores.get(id);
    if (!score) {
      score = { kills: 0, deaths: 0 };
      this.scores.set(id, score);
    }
    return score;
  }
}
