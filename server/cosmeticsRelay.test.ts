import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { MultiplayerClient } from '../src/network/MultiplayerClient';
import type { MultiplayerSnapshot } from '../src/network/types';
import { PORT, sleep, TestClient, useWsServer } from './wsTestHarness';

// drives the real websocket server: cosmetics ride the join, changes go out as
// their own relayed message at 1 hz, and 30 hz snapshots never carry them.

useWsServer();

const wire = (seed: number) => ({ k: 'karambit', f: 'doppler_ruby', w: 0.01, s: seed });
const cosmeticsMessages = (client: TestClient) => client.messages.filter((m) => m.type === 'cosmetics');

describe('websocket server cosmetics', () => {
  it('sends the roster on join, relays a burst of changes as one message, and keeps snapshots clean', async () => {
    const a = await TestClient.open();
    const b = await TestClient.open();
    try {
      await a.enter('cosm_ws_a', [0, 0, 0], 0, wire(1));
      await b.enter('cosm_ws_a', [2, 0, 0], 0);
      // b gets a's cosmetics once, in the roster that follows its join
      const roster = await b.waitFor((m) => m.type === 'cosmetics');
      expect(roster.players).toEqual([{ id: a.id, c: wire(1) }]);

      // a hears nothing back: b has no cosmetics and a's own change isn't echoed
      await sleep(1200);
      expect(cosmeticsMessages(a).filter((m) => (m.players as unknown[]).length > 0)).toEqual([]);

      // a floods 40 changes in 0.4 s
      b.clear();
      for (let i = 0; i < 40; i += 1) {
        a.send({ type: 'cosmetics', c: wire(100 + i) });
        await sleep(10);
      }
      await sleep(2300);
      const relays = cosmeticsMessages(b);
      expect(relays.length).toBeGreaterThanOrEqual(1);
      expect(relays.length).toBeLessThanOrEqual(2);
      expect(relays.at(-1)!.players).toEqual([{ id: a.id, c: wire(139) }]);

      // an idle room relays nothing, and snapshots never carry cosmetics
      b.clear();
      await sleep(1500);
      expect(cosmeticsMessages(b)).toEqual([]);
      const snapshots = b.messages.filter((m) => m.type === 'snapshot');
      expect(snapshots.length).toBeGreaterThan(20);
      for (const snap of snapshots) {
        for (const row of snap.players as Array<Record<string, unknown>>) expect(row).not.toHaveProperty('c');
      }

      // clearing is relayed as a row without c
      a.send({ type: 'cosmetics' });
      const cleared = await b.waitFor((m) => m.type === 'cosmetics', 2500);
      expect(cleared.players).toEqual([{ id: a.id }]);
    } finally {
      a.close();
      b.close();
    }
  }, 20000);

  it('the real client applies roster and relays to snapshot rows', async () => {
    const original = globalThis.WebSocket;
    const originalWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { WebSocket: unknown }).WebSocket = WebSocket;
    // the client schedules its heartbeat and reconnects on window
    (globalThis as { window?: unknown }).window = globalThis;
    const a = await TestClient.open();
    const client = new MultiplayerClient(`ws://127.0.0.1:${PORT}/ws`);
    let latest: MultiplayerSnapshot | null = null;
    client.onSnapshot = (snap) => {
      latest = snap;
    };
    try {
      await a.enter('cosm_ws_b', [0, 0, 0], 0, wire(5));
      client.setCosmetics({ knife: { id: 'flip', finish: 'fade', wear: 0.03, seed: 9 } });
      client.connect();
      client.join('cosm_ws_b', 'Observer', 'counterterrorist');
      const rowOf = () => (latest as MultiplayerSnapshot | null)?.players.find((p) => p.id === a.id);
      for (let i = 0; i < 100 && !rowOf()?.cosmetics; i += 1) await sleep(20);
      expect(rowOf()?.cosmetics).toEqual({ knife: { id: 'karambit', finish: 'doppler_ruby', wear: 0.01, seed: 5 } });

      // the client's own pick rode its join, so a hears it on the next relay
      const relay = await a.waitFor((m) => m.type === 'cosmetics' && (m.players as unknown[]).length > 0, 2500);
      expect(relay.players).toEqual([{ id: client.getLocalId(), c: { k: 'flip', f: 'fade', w: 0.03, s: 9 } }]);

      a.send({ type: 'cosmetics', c: wire(6) });
      for (let i = 0; i < 150 && rowOf()?.cosmetics?.knife?.seed !== 6; i += 1) await sleep(20);
      expect(rowOf()?.cosmetics?.knife?.seed).toBe(6);
    } finally {
      client.disconnect();
      a.close();
      (globalThis as { WebSocket: unknown }).WebSocket = original;
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  }, 20000);
});
