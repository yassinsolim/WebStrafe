export interface KillFeedEntry {
  killer: string;
  victim: string;
  weaponId: string;
  headshot: boolean;
  createdAtMs: number;
}

/**
 * Pure kill-feed model: a bounded, time-limited list of recent kills. Framework
 * free so it can be unit-tested; the HUD renders whatever `visible()` returns.
 */
export class KillFeed {
  private readonly entries: KillFeedEntry[] = [];

  constructor(
    private readonly ttlMs = 6000,
    private readonly maxEntries = 5,
  ) {}

  add(entry: Omit<KillFeedEntry, 'createdAtMs'>, nowMs: number): void {
    this.entries.push({ ...entry, createdAtMs: nowMs });
    // Drop oldest beyond the cap.
    while (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
  }

  /** Entries still within their TTL, newest last. */
  visible(nowMs: number): KillFeedEntry[] {
    return this.entries.filter((e) => nowMs - e.createdAtMs < this.ttlMs);
  }

  /** Removes expired entries; call periodically to bound memory. */
  prune(nowMs: number): void {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (nowMs - this.entries[i].createdAtMs >= this.ttlMs) {
        this.entries.splice(i, 1);
      }
    }
  }

  clear(): void {
    this.entries.length = 0;
  }
}
