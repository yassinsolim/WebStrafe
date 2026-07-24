import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Scene,
  Vector3,
} from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CombatEffects,
  REMOTE_SHOT_EFFECTS,
  type ShotEffectRequest,
} from '../../combat/CombatEffects';
import {
  createRemoteShotHandler,
  presentFirearmShot,
} from '../../combat/FirearmShotFeedback';
import type { ShotEvent } from '../MultiplayerTransport';
import { CollisionWorld } from '../../world/CollisionWorld';
import { MultiplayerClient } from '../MultiplayerClient';

class FakeWebSocket extends EventTarget {
  public static readonly CONNECTING = 0;
  public static readonly OPEN = 1;
  public static readonly CLOSING = 2;
  public static readonly CLOSED = 3;
  public static instances: FakeWebSocket[] = [];

  public readyState = FakeWebSocket.CONNECTING;
  public readonly sent: string[] = [];

  constructor(public readonly url: string) {
    super();
    FakeWebSocket.instances.push(this);
  }

  public serverMessage(payload: Record<string, unknown>): void {
    const event = new Event('message') as MessageEvent;
    Object.defineProperty(event, 'data', { value: JSON.stringify(payload) });
    this.dispatchEvent(event);
  }

  public send(data: string): void {
    this.sent.push(data);
  }

  public close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(new Event('close'));
  }
}

const originalWebSocket = globalThis.WebSocket;

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
  FakeWebSocket.instances = [];
  vi.restoreAllMocks();
});

function createHarness() {
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  const client = new MultiplayerClient('ws://test.invalid/ws');
  const scene = new Scene();
  const effects = new CombatEffects(scene);
  const collisionWorld = new CollisionWorld();
  let nowMs = 1000;
  const spawnSpy = vi.spyOn(effects, 'spawnShot');
  let lastShot: ShotEvent | null = null;
  const presentRemoteShot = createRemoteShotHandler({
    effects,
    collisionWorld,
    getLocalPlayerId: () => client.getLocalId(),
    nowMs: () => nowMs,
  });
  client.onShot = (event) => {
    lastShot = event;
    presentRemoteShot(event);
  };
  client.connect();
  const socket = FakeWebSocket.instances[0];
  socket.serverMessage({ type: 'welcome', id: 'local-player' });
  return {
    client,
    effects,
    scene,
    socket,
    spawnSpy,
    getLastShot: () => lastShot,
    setNow: (value: number) => { nowMs = value; },
  };
}

describe('MultiplayerClient remote shot feedback integration', () => {
  it('presents a real bot shot payload at its authoritative endpoint and cleans it up', () => {
    const harness = createHarness();
    harness.socket.serverMessage({
      type: 'shot',
      sequence: 1,
      result: 'kill',
      playerId: 'bot:0',
      targetId: 'local-player',
      weaponId: 'deagle',
      origin: [0, 1.2, -20],
      dir: [0, 0, 1],
      endpoint: [0, 1.2, -0.34],
      impactNormal: [0, 0, -1],
    });

    expect(harness.spawnSpy).toHaveBeenCalledTimes(1);
    const request = harness.spawnSpy.mock.calls[0][0] as ShotEffectRequest;
    expect(request.remote).toBe(true);
    expect(harness.getLastShot()?.targetId).toBe('local-player');
    expect(request.fatal).toBe(true);
    expect(request.weaponId).toBe('deagle');
    expect(request.from.toArray()).toEqual([-0.18, 1.04, -19.42]);
    expect(request.to.toArray()).toEqual([0, 1.2, -0.34]);
    expect(request.impactNormal?.toArray()).toEqual([0, 0, -1]);
    expect(harness.effects.getActiveCount()).toBe(3);
    expect(
      harness.scene.children.map((child) => child.userData.effectType).sort(),
    ).toEqual(['impact-glow', 'muzzle', 'tracer']);
    expect(
      harness.scene.children.find(
        (child) => child.userData.effectType === 'impact-glow',
      )?.visible,
    ).toBe(false);

    harness.effects.update(1000 + REMOTE_SHOT_EFFECTS.deagle.travelMs - 1);
    expect(
      harness.scene.children.find(
        (child) => child.userData.effectType === 'impact-glow',
      )?.visible,
    ).toBe(false);
    harness.effects.update(1000 + REMOTE_SHOT_EFFECTS.deagle.travelMs);
    expect(
      harness.scene.children.find(
        (child) => child.userData.effectType === 'impact-glow',
      )?.visible,
    ).toBe(true);
    harness.effects.update(1000 + REMOTE_SHOT_EFFECTS.deagle.fatalTracerMs);
    expect(harness.effects.getActiveCount()).toBeGreaterThan(0);
    const impactExpiry =
      1000
      + REMOTE_SHOT_EFFECTS.deagle.travelMs
      + REMOTE_SHOT_EFFECTS.deagle.fatalImpactMs;
    harness.effects.update(impactExpiry - 1);
    expect(harness.effects.getActiveCount()).toBe(1);
    harness.effects.update(impactExpiry);
    expect(harness.effects.getActiveCount()).toBe(0);
    expect(harness.scene.children).toHaveLength(0);
    harness.client.disconnect();
    harness.effects.dispose();
  });


  it('delivers stored combat-ready state immediately after authoritative join', () => {
    const harness = createHarness();
    harness.socket.readyState = FakeWebSocket.OPEN;
    harness.client.setCombatReady(true);
    harness.client.join('training_straight', 'Tester', 'terrorist');
    harness.socket.serverMessage({ type: 'joined', mapId: 'training_straight' });

    const sent = harness.socket.sent.map((payload) => JSON.parse(payload) as Record<string, unknown>);
    expect(sent).toContainEqual({ type: 'combat-ready', ready: true });
    harness.client.disconnect();
    harness.effects.dispose();
  });

  it('filters only the exact local id and accepts an ordinary remote peer payload', () => {
    const harness = createHarness();
    const localPayload = {
      type: 'shot',
      sequence: 2,
      result: 'miss',
      playerId: 'local-player',
      weaponId: 'awp',
      origin: [1, 2, 10],
      dir: [0, 0, -1],
    };
    harness.socket.serverMessage(localPayload);
    expect(harness.spawnSpy).not.toHaveBeenCalled();

    harness.setNow(2000);
    harness.socket.serverMessage({ ...localPayload, playerId: 'peer-player' });
    expect(harness.spawnSpy).toHaveBeenCalledTimes(1);
    const request = harness.spawnSpy.mock.calls[0][0] as ShotEffectRequest;
    expect(request.remote).toBe(true);
    expect(request.from.x).toBeCloseTo(1.14, 8);
    expect(request.from.y).toBeCloseTo(1.85, 8);
    expect(request.from.z).toBeCloseTo(9.3, 8);
    expect(request.to.toArray()).toEqual([1, 2, -110]);

    harness.effects.update(2000 + REMOTE_SHOT_EFFECTS.awp.tracerMs);
    expect(harness.effects.getActiveCount()).toBe(0);
    harness.client.disconnect();
    harness.effects.dispose();
  });

  it('rejects malformed cast payloads from an unvalidated realtime transport', () => {
    const harness = createHarness();
    const malformed = {
      playerId: 'bot:0',
      weaponId: 'deagle',
      origin: null,
      dir: { x: 0, y: 0, z: 1 },
    } as unknown as ShotEvent;

    expect(() => harness.client.onShot?.(malformed)).not.toThrow();
    expect(() => harness.client.onShot?.(null as unknown as ShotEvent)).not.toThrow();
    expect(harness.spawnSpy).not.toHaveBeenCalled();
    harness.client.disconnect();
    harness.effects.dispose();
  });

  it('clips a remote authoritative endpoint to a nearer occluding wall', () => {
    const collisionWorld = new CollisionWorld();
    const root = new Group();
    const wall = new Mesh(
      new BoxGeometry(4, 4, 0.2),
      new MeshBasicMaterial(),
    );
    wall.position.set(0, 1, -5);
    root.add(wall);
    collisionWorld.setCollisionFromRoot(root);
    const spawnShot = vi.fn();

    expect(presentFirearmShot(
      { effects: { spawnShot }, collisionWorld },
      {
        weaponId: 'deagle',
        origin: new Vector3(0, 1, 0),
        direction: new Vector3(0, 0, -1),
        nowMs: 10,
        local: false,
        resolvedEndpoint: new Vector3(0, 1, -20),
        resolvedImpactNormal: new Vector3(0, 0, 1),
      },
    )).toBe(true);

    expect(spawnShot).toHaveBeenCalledTimes(1);
    const request = spawnShot.mock.calls[0][0] as ShotEffectRequest;
    expect(request.to.z).toBeCloseTo(-4.9, 4);
    expect(request.to.z).toBeGreaterThan(-20);
    expect(request.impactNormal?.z).toBeGreaterThan(0.99);
  });
});
