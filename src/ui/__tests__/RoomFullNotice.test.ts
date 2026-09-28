import { describe, expect, it } from 'vitest';
import { ROOM_FULL_MAX_SHOWS, ROOM_FULL_NOTICE_MS, RoomFullNotice } from '../RoomFullNotice';

describe('RoomFullNotice', () => {
  it('shows nothing until the room turns the player away', () => {
    expect(new RoomFullNotice().takeForPlay()).toBeNull();
  });

  it('survives the menu and shows once the player is in the map, a few times', () => {
    const notice = new RoomFullNotice();
    notice.raise();
    const shown: Array<{ text: string; durationMs: number } | null> = [];
    for (let i = 0; i < ROOM_FULL_MAX_SHOWS + 2; i += 1) shown.push(notice.takeForPlay());
    expect(shown.filter(Boolean)).toHaveLength(ROOM_FULL_MAX_SHOWS);
    expect(shown[0]!.text).toMatch(/Room is full \(6\/6\)/);
    expect(shown[0]!.durationMs).toBe(ROOM_FULL_NOTICE_MS);
    expect(notice.isActive()).toBe(false);
  });

  it('clears when the player gets a seat, and re-arms on a new rejection', () => {
    const notice = new RoomFullNotice();
    notice.raise();
    notice.takeForPlay();
    notice.clear();
    expect(notice.takeForPlay()).toBeNull();
    notice.raise();
    expect(notice.takeForPlay()).not.toBeNull();
  });
});
