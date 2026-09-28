import http from 'node:http';
import { WebSocket, WebSocketServer, type RawData } from 'ws';

/**
 * websocket relay that adds one-way delay, jitter and loss to each direction.
 *
 * websockets ride on tcp, so a "lost" packet is never dropped for the app: it
 * shows up late after a retransmit and holds back everything queued behind it
 * (head-of-line blocking). that's modelled here as an extra `rtoMs` stall that
 * keeps message order intact.
 */
export interface LinkProfile {
  /** one-way base delay in ms (rtt is roughly 2x this) */
  delayMs: number;
  /** uniform +/- jitter in ms added per message */
  jitterMs: number;
  /** 0..1 chance a message needs a tcp retransmit */
  loss: number;
  /** retransmit stall applied to lost messages */
  rtoMs: number;
}

export interface LinkStats {
  upBytes: number;
  downBytes: number;
  upMessages: number;
  downMessages: number;
}

export interface LatencyProxy {
  port: number;
  stats: Map<string, LinkStats>;
  close(): Promise<void>;
}

class DelayQueue {
  private lastDeliverAt = 0;
  private readonly queue: Array<{ at: number; deliver: () => void }> = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly profile: LinkProfile, private readonly rng: () => number) {}

  push(deliver: () => void): void {
    const p = this.profile;
    const jitter = p.jitterMs > 0 ? (this.rng() * 2 - 1) * p.jitterMs : 0;
    const stall = p.loss > 0 && this.rng() < p.loss ? p.rtoMs : 0;
    const now = performance.now();
    // tcp keeps order, so a message can't overtake the one before it
    const at = Math.max(this.lastDeliverAt, now + Math.max(0, p.delayMs + jitter) + stall);
    this.lastDeliverAt = at;
    this.queue.push({ at, deliver });
    this.arm();
  }

  // one timer for the head of a fifo, so equal-ms timers can never reorder
  private arm(): void {
    if (this.timer || this.queue.length === 0) return;
    const wait = Math.max(0, this.queue[0].at - performance.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      const now = performance.now();
      while (this.queue.length > 0 && this.queue[0].at <= now + 0.5) {
        this.queue.shift()!.deliver();
      }
      this.arm();
    }, wait);
  }
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function startLatencyProxy(
  upstreamUrl: string,
  profile: LinkProfile,
  seed = 1,
): Promise<LatencyProxy> {
  const server = http.createServer();
  const wss = new WebSocketServer({ server });
  const stats = new Map<string, LinkStats>();
  let nextId = 0;
  const rng = mulberry32(seed);

  wss.on('connection', (downstream, req) => {
    const label = new URL(req.url ?? '/', 'http://x').searchParams.get('label') ?? `c${nextId++}`;
    const s: LinkStats = { upBytes: 0, downBytes: 0, upMessages: 0, downMessages: 0 };
    stats.set(label, s);
    const upstream = new WebSocket(upstreamUrl, { headers: { origin: 'http://localhost' } });
    const upQueue = new DelayQueue(profile, rng);
    const downQueue = new DelayQueue(profile, rng);
    const pendingUp: Array<{ data: RawData; isBinary: boolean }> = [];

    downstream.on('message', (data, isBinary) => {
      const size = Buffer.isBuffer(data) ? data.length : Array.isArray(data) ? data.reduce((n, b) => n + b.length, 0) : data.byteLength;
      s.upBytes += size;
      s.upMessages += 1;
      upQueue.push(() => {
        if (upstream.readyState === WebSocket.OPEN) {
          upstream.send(data, { binary: isBinary });
        } else {
          pendingUp.push({ data, isBinary });
        }
      });
    });
    upstream.on('open', () => {
      for (const m of pendingUp.splice(0)) upstream.send(m.data, { binary: m.isBinary });
    });
    upstream.on('message', (data, isBinary) => {
      const size = Buffer.isBuffer(data) ? data.length : Array.isArray(data) ? data.reduce((n, b) => n + b.length, 0) : data.byteLength;
      s.downBytes += size;
      s.downMessages += 1;
      downQueue.push(() => {
        if (downstream.readyState === WebSocket.OPEN) downstream.send(data, { binary: isBinary });
      });
    });
    const closeBoth = () => {
      if (downstream.readyState === WebSocket.OPEN) downstream.close();
      if (upstream.readyState === WebSocket.OPEN) upstream.close();
    };
    downstream.on('close', closeBoth);
    upstream.on('close', closeBoth);
    upstream.on('error', closeBoth);
    downstream.on('error', closeBoth);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    port,
    stats,
    close: () => new Promise((resolve) => {
      for (const c of wss.clients) c.terminate();
      wss.close();
      server.close(() => resolve());
    }),
  };
}
