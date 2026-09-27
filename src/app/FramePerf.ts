/**
 * frame timing for perf runs (?shot=...&perf=<s>): rAF-to-rAF frame times, the
 * cpu time spent inside the game loop, and draw calls / triangles summed over
 * both render passes.
 */
export interface FramePerfResult {
  frames: number;
  fpsMedian: number;
  fps1Low: number;
  frameMsMedian: number;
  frameMsP99: number;
  cpuMsMedian: number;
  cpuMsP99: number;
  calls: number;
  triangles: number;
  /** frames slower than 16.7 and 33.3 ms, and the slowest few with their time since start */
  over16: number;
  over33: number;
  worst: Array<[number, number]>;
  pixelRatio: number;
  canvas: [number, number];
}

export class FramePerf {
  private readonly frameMs: number[] = [];
  private readonly cpuMs: number[] = [];
  private readonly stamps: number[] = [];
  private lastTime = -1;
  private calls = 0;
  private triangles = 0;
  private startAt = -1;
  public done = false;

  constructor(private readonly durationMs: number, private readonly warmupMs = 1500) {}

  /** call at the top of the loop with the rAF timestamp */
  frame(time: number): void {
    if (this.startAt < 0) this.startAt = time;
    const warm = time - this.startAt >= this.warmupMs;
    if (warm && this.lastTime >= 0) {
      this.frameMs.push(time - this.lastTime);
      this.stamps.push(time - this.startAt);
    }
    this.lastTime = time;
    if (time - this.startAt >= this.warmupMs + this.durationMs) this.done = true;
  }

  /** call after the last render of the frame */
  cpu(ms: number, calls: number, triangles: number): void {
    if (this.frameMs.length === 0) return;
    this.cpuMs.push(ms);
    this.calls = calls;
    this.triangles = triangles;
  }

  result(pixelRatio: number, canvas: [number, number]): FramePerfResult {
    const sorted = [...this.frameMs].sort((a, b) => a - b);
    const cpu = [...this.cpuMs].sort((a, b) => a - b);
    const pick = (list: number[], q: number) => list.length ? list[Math.min(list.length - 1, Math.floor(q * list.length))] : 0;
    // 1% low: average fps of the slowest 1% of frames
    const worst = sorted.slice(Math.floor(sorted.length * 0.99));
    const worstMean = worst.length ? worst.reduce((a, b) => a + b, 0) / worst.length : 0;
    const med = pick(sorted, 0.5);
    const round = (v: number) => Math.round(v * 100) / 100;
    return {
      frames: sorted.length,
      fpsMedian: round(med ? 1000 / med : 0),
      fps1Low: round(worstMean ? 1000 / worstMean : 0),
      frameMsMedian: round(med),
      frameMsP99: round(pick(sorted, 0.99)),
      cpuMsMedian: round(pick(cpu, 0.5)),
      cpuMsP99: round(pick(cpu, 0.99)),
      over16: this.frameMs.filter((v) => v > 16.7).length,
      over33: this.frameMs.filter((v) => v > 33.3).length,
      worst: this.frameMs.map((v, i) => [round(v), Math.round(this.stamps[i])] as [number, number]).sort((a, b) => b[0] - a[0]).slice(0, 6),
      calls: this.calls,
      triangles: this.triangles,
      pixelRatio,
      canvas,
    };
  }
}
