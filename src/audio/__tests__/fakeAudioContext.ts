/**
 * Minimal Web Audio stand-in for node tests. It records the graph and every
 * automation call, and throws on the same invalid input real browsers reject
 * (non-finite values, exponential ramps to zero or below).
 */

export interface ParamEvent {
  type: 'set' | 'linear' | 'exp' | 'target' | 'cancel';
  value: number;
  time: number;
}

function assertFinite(value: number, what: string): void {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${what} must be finite, got ${value}`);
  }
}

export class FakeParam {
  public readonly events: ParamEvent[] = [];

  constructor(public value = 0) {}

  setValueAtTime(value: number, time: number): this {
    assertFinite(value, 'value');
    assertFinite(time, 'time');
    this.events.push({ type: 'set', value, time });
    this.value = value;
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): this {
    assertFinite(value, 'value');
    assertFinite(time, 'time');
    this.events.push({ type: 'linear', value, time });
    this.value = value;
    return this;
  }

  exponentialRampToValueAtTime(value: number, time: number): this {
    assertFinite(value, 'value');
    assertFinite(time, 'time');
    if (value <= 0) {
      throw new RangeError('exponential ramp target must be positive');
    }
    this.events.push({ type: 'exp', value, time });
    this.value = value;
    return this;
  }

  setTargetAtTime(value: number, time: number, constant: number): this {
    assertFinite(value, 'value');
    assertFinite(time, 'time');
    assertFinite(constant, 'time constant');
    this.events.push({ type: 'target', value, time });
    this.value = value;
    return this;
  }

  cancelScheduledValues(time: number): this {
    assertFinite(time, 'time');
    this.events.push({ type: 'cancel', value: this.value, time });
    return this;
  }
}

export class FakeNode {
  public readonly outputs: FakeNode[] = [];
  public readonly inputs: FakeNode[] = [];

  constructor(public readonly context: FakeAudioContext, public readonly kind: string) {
    context.nodes.push(this);
  }

  connect<T extends FakeNode>(destination: T): T {
    this.outputs.push(destination);
    destination.inputs.push(this);
    return destination;
  }

  disconnect(): void {
    for (const output of this.outputs) {
      const index = output.inputs.indexOf(this);
      if (index >= 0) {
        output.inputs.splice(index, 1);
      }
    }
    this.outputs.length = 0;
  }
}

export class FakeGain extends FakeNode {
  public readonly gain = new FakeParam(1);
  constructor(context: FakeAudioContext) {
    super(context, 'gain');
  }
}

export class FakeBiquad extends FakeNode {
  public type: BiquadFilterType = 'lowpass';
  public readonly frequency = new FakeParam(350);
  public readonly Q = new FakeParam(1);
  public readonly gain = new FakeParam(0);
  constructor(context: FakeAudioContext) {
    super(context, 'biquad');
  }
}

export class FakeStereoPanner extends FakeNode {
  public readonly pan = new FakeParam(0);
  constructor(context: FakeAudioContext) {
    super(context, 'stereoPanner');
  }
}

export class FakePanner extends FakeNode {
  public panningModel: PanningModelType = 'equalpower';
  public distanceModel: DistanceModelType = 'inverse';
  public refDistance = 1;
  public rolloffFactor = 1;
  public readonly positionX = new FakeParam(0);
  public readonly positionY = new FakeParam(0);
  public readonly positionZ = new FakeParam(0);
  constructor(context: FakeAudioContext) {
    super(context, 'panner');
  }
}

export class FakeScheduledSource extends FakeNode {
  public readonly starts: Array<{ when: number; offset?: number; duration?: number }> = [];
  public readonly stops: number[] = [];

  start(when = 0, offset?: number, duration?: number): void {
    assertFinite(when, 'start time');
    if (when < 0) {
      throw new RangeError('start time must be >= 0');
    }
    if (offset !== undefined) assertFinite(offset, 'offset');
    if (duration !== undefined) assertFinite(duration, 'duration');
    if (this.starts.length > 0) {
      throw new Error('source started twice');
    }
    this.starts.push({ when, offset, duration });
  }

  stop(when = 0): void {
    assertFinite(when, 'stop time');
    this.stops.push(when);
  }
}

export class FakeBufferSource extends FakeScheduledSource {
  public buffer: FakeAudioBuffer | null = null;
  public readonly playbackRate = new FakeParam(1);
  public readonly detune = new FakeParam(0);
  public loop = false;
  constructor(context: FakeAudioContext) {
    super(context, 'bufferSource');
  }
}

export class FakeOscillator extends FakeScheduledSource {
  public type: OscillatorType = 'sine';
  public readonly frequency = new FakeParam(440);
  public readonly detune = new FakeParam(0);
  constructor(context: FakeAudioContext) {
    super(context, 'oscillator');
  }
}

export class FakeAudioBuffer {
  private readonly channels: Float32Array[];

  constructor(
    public readonly numberOfChannels: number,
    public readonly length: number,
    public readonly sampleRate: number,
    public readonly label = '',
  ) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  get duration(): number {
    return this.length / this.sampleRate;
  }

  getChannelData(channel: number): Float32Array {
    return this.channels[channel];
  }
}

export class FakeAudioContext {
  public state: AudioContextState = 'running';
  public currentTime = 2;
  public sampleRate = 8000;
  public readonly nodes: FakeNode[] = [];
  public readonly destination: FakeNode;
  public readonly listener = {
    positionX: new FakeParam(0),
    positionY: new FakeParam(0),
    positionZ: new FakeParam(0),
    forwardX: new FakeParam(0),
    forwardY: new FakeParam(0),
    forwardZ: new FakeParam(-1),
    upX: new FakeParam(0),
    upY: new FakeParam(1),
    upZ: new FakeParam(0),
  };
  public resumeCalls = 0;

  constructor() {
    this.destination = new FakeNode(this, 'destination');
  }

  async resume(): Promise<void> {
    this.resumeCalls += 1;
    this.state = 'running';
  }

  async close(): Promise<void> {
    this.state = 'closed';
  }

  createGain(): FakeGain {
    return new FakeGain(this);
  }

  createBiquadFilter(): FakeBiquad {
    return new FakeBiquad(this);
  }

  createStereoPanner(): FakeStereoPanner {
    return new FakeStereoPanner(this);
  }

  createPanner(): FakePanner {
    return new FakePanner(this);
  }

  createBufferSource(): FakeBufferSource {
    return new FakeBufferSource(this);
  }

  createOscillator(): FakeOscillator {
    return new FakeOscillator(this);
  }

  createDynamicsCompressor(): FakeNode & Record<string, FakeParam> {
    const node = new FakeNode(this, 'compressor') as FakeNode & Record<string, FakeParam>;
    for (const name of ['threshold', 'knee', 'ratio', 'attack', 'release']) {
      node[name] = new FakeParam(0);
    }
    return node;
  }

  createConvolver(): FakeNode & { buffer: FakeAudioBuffer | null } {
    const node = new FakeNode(this, 'convolver') as FakeNode & { buffer: FakeAudioBuffer | null };
    node.buffer = null;
    return node;
  }

  createWaveShaper(): FakeNode & { curve: Float32Array | null } {
    const node = new FakeNode(this, 'waveShaper') as FakeNode & { curve: Float32Array | null };
    node.curve = null;
    return node;
  }

  createBuffer(channels: number, length: number, sampleRate: number): FakeAudioBuffer {
    return new FakeAudioBuffer(channels, length, sampleRate);
  }

  /** fake decode: one second of audio per 1000 bytes, labelled with the first byte */
  async decodeAudioData(data: ArrayBuffer): Promise<FakeAudioBuffer> {
    const label = String(new Uint8Array(data)[0] ?? '');
    return new FakeAudioBuffer(1, Math.max(1, Math.round((data.byteLength / 1000) * this.sampleRate)), this.sampleRate, label);
  }

  of<T extends FakeNode>(kind: string): T[] {
    return this.nodes.filter((node) => node.kind === kind) as T[];
  }
}

/** true when audio from `node` reaches `target` through the recorded graph */
export function reaches(node: FakeNode, target: FakeNode, seen = new Set<FakeNode>()): boolean {
  if (node === target) {
    return true;
  }
  if (seen.has(node)) {
    return false;
  }
  seen.add(node);
  return node.outputs.some((next) => reaches(next, target, seen));
}

export function asContext(fake: FakeAudioContext): AudioContext {
  return fake as unknown as AudioContext;
}
