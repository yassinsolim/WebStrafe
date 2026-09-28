import { MAX_ROOM_PLAYERS } from '../netcode/RateBudget';

export const ROOM_FULL_TEXT =
  `Room is full (${MAX_ROOM_PLAYERS}/${MAX_ROOM_PLAYERS}): you're playing solo. Pick another map or rejoin later.`;
/** long enough to read after the map-loaded flash */
export const ROOM_FULL_NOTICE_MS = 8000;
/** re-shown on each entry into play (load, resume) up to this many times */
export const ROOM_FULL_MAX_SHOWS = 3;

/**
 * The room-full event fires while the player is still on the menu or the
 * loading screen, where the status line is immediately replaced by "Map
 * loaded". This remembers it and hands the notice back each time the player
 * actually enters play, until they've seen it a few times or get a seat.
 */
export class RoomFullNotice {
  private pending = false;
  private shows = 0;

  raise(): void {
    this.pending = true;
    this.shows = 0;
  }

  /** a room seat was granted (reconnect, another map) */
  clear(): void {
    this.pending = false;
    this.shows = 0;
  }

  isActive(): boolean {
    return this.pending && this.shows < ROOM_FULL_MAX_SHOWS;
  }

  /** Call when the player enters play; returns the notice to show, if any. */
  takeForPlay(): { text: string; durationMs: number } | null {
    if (!this.isActive()) {
      return null;
    }
    this.shows += 1;
    return { text: ROOM_FULL_TEXT, durationMs: ROOM_FULL_NOTICE_MS };
  }
}
