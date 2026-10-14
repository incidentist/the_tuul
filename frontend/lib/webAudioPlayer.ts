import SignalsmithStretch, { StretchNode } from "signalsmith-stretch";

export type Engine = "buffer" | "stretch";

// A start scheduled this far ahead of the audio clock lands exactly where it was asked for.
const SCHEDULE_AHEAD = 0.03;

// A track loaded during playback fades in over the one it replaces for this long, since cutting
// one mid-waveform clicks.
const SWAP_FADE_SECONDS = 0.02;

// The stretch node keeps working on silence until it is stopped, which it is this long after its
// output has been cut.
const STRETCH_IDLE_SECONDS = 0.1;

// Most outputs run at this rate. A track is decoded at it until a context gives the actual one.
const DEFAULT_SAMPLE_RATE = 48000;

// The song time `input` reaches the output at context time `output`, and moves on at `rate`.
export interface Span {
  input: number;
  output: number;
  rate: number;
}

interface Playing {
  context: AudioContext;
  engine: Engine;
  // The spans in the order they start. A rate change adds one.
  spans: Span[];
  // The song time playback stops at, reached at context time `outputEnd`.
  end: number;
  outputEnd: number;
  source: AudioBufferSourceNode | null;
  // The buffer source's own gain, which fades it out when another track replaces it.
  fader: GainNode | null;
}

interface Stretch {
  node: StretchNode;
  gain: GainNode;
  latency: number;
  // The track whose samples the node holds, once `loaded` settles.
  buffer: AudioBuffer | null;
  loaded: Promise<unknown>;
}

export interface WebAudioPlayerOptions {
  createContext?: () => AudioContext;
  createStretch?: (context: AudioContext, channels: number) => Promise<StretchNode>;
  decode?: (blob: Blob, sampleRate: number) => Promise<AudioBuffer>;
  // Whether a hidden page pauses playback. A paused player closes its AudioContext all the same.
  pauseWhenHidden?: boolean;
}

/**
 * Signalsmith Stretch keeps the pitch at other rates. At exactly 1x, or with the pitch let go, a
 * plain buffer source plays the samples as they are.
 */
export function engineFor(rate: number, preservesPitch: boolean): Engine {
  return rate !== 1 && preservesPitch ? "stretch" : "buffer";
}

/**
 * The context time reaching the output at `at`, a `performance.now()` time, from a timestamp
 * taken at `now`.
 */
export function heardContextTime(
  stamp: AudioTimestamp,
  currentTime: number,
  outputLatency: number,
  now: number,
  at = now,
): number {
  const { contextTime = 0, performanceTime = 0 } = stamp;
  // A context that hasn't output anything yet has no timestamp.
  if (!performanceTime) return Math.max(0, currentTime - outputLatency);
  const stamped = contextTime + (now - performanceTime) / 1000;
  // Chrome's timestamp already trails the context's time by the output latency. Firefox's
  // doesn't, so the part of the latency it leaves out is taken off here.
  const unaccounted = Math.max(0, outputLatency - (currentTime - stamped));
  return Math.min(currentTime, stamped - unaccounted) - (now - at) / 1000;
}

/**
 * The song time heard at context time `time`. It holds at the first span's input until that span
 * starts.
 */
export function songTimeAt(spans: Span[], time: number): number {
  let span = spans[0];
  for (const candidate of spans) {
    if (candidate.output <= time) span = candidate;
  }
  return span.input + Math.max(0, time - span.output) * span.rate;
}

async function decodeTrack(blob: Blob, sampleRate: number): Promise<AudioBuffer> {
  const context = new OfflineAudioContext(1, 1, sampleRate);
  return context.decodeAudioData(await blob.arrayBuffer());
}

async function createStretchNode(context: AudioContext, channels: number): Promise<StretchNode> {
  return SignalsmithStretch(context, {
    // The node outputs silence without an input, even though it plays from its own buffers.
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [channels],
  });
}

/**
 * Plays a decoded track through Web Audio, with starts and ends scheduled on the audio clock, and
 * reports the song time being heard. Its interface follows the media element's where it can.
 *
 * It emits `play`, `pause`, `seeking`, `timeupdate` on every frame while playing, `ended` before
 * the `pause` of a range or track that has played to its end, and `loadstart` and `loadeddata`
 * around decoding a track.
 *
 * It pauses when the page is hidden, unless told to play on, and closes its AudioContext, so the
 * next play uses a new one. Firefox keeps a context's output latency from when it started, so a
 * change of output made meanwhile would otherwise put the position off for good. Losing the focus
 * alone doesn't pause it, since GNOME takes the focus away for as long as a volume key is held.
 */
export class WebAudioPlayer extends EventTarget {
  private blob: Blob | null = null;
  private buffer: AudioBuffer | null = null;
  private loadingTrack: Promise<void> | null = null;
  private loads = 0;
  private context: AudioContext | null = null;
  private stretch: Promise<Stretch> | null = null;
  // The settled `stretch`, which a stop has to reach without waiting.
  private stretchReady: Stretch | null = null;
  private stretchTimer: ReturnType<typeof setTimeout> | undefined;
  private playing: Playing | null = null;
  // Whether playback was asked for and hasn't paused since. It may still be starting.
  private wanted = false;
  // Everything that changes what plays bumps this, so a start still waiting gives up.
  private starts = 0;
  private position = 0;
  private range: { start: number; end: number } | null = null;
  private rate = 1;
  private pitch = true;
  private frame = 0;
  private lastReported = -1;
  private readonly createContext: () => AudioContext;
  private readonly createStretch: (context: AudioContext, channels: number) => Promise<StretchNode>;
  private readonly decode: (blob: Blob, sampleRate: number) => Promise<AudioBuffer>;
  private readonly pauseWhenHidden: boolean;

  constructor(options: WebAudioPlayerOptions = {}) {
    super();
    this.createContext =
      options.createContext ?? (() => new AudioContext({ latencyHint: "interactive" }));
    this.createStretch = options.createStretch ?? createStretchNode;
    this.decode = options.decode ?? decodeTrack;
    this.pauseWhenHidden = options.pauseWhenHidden ?? true;
    document.addEventListener("visibilitychange", this.onVisibilityChange);
  }

  get duration(): number {
    return this.buffer?.duration ?? NaN;
  }

  get paused(): boolean {
    return !this.wanted;
  }

  // The track being played, once decoded.
  get decoded(): AudioBuffer | null {
    return this.buffer;
  }

  get loading(): boolean {
    return !!this.blob && this.buffer === null;
  }

  // The engine playing, or null while paused or starting.
  get engine(): Engine | null {
    return this.playing?.engine ?? null;
  }

  get currentTime(): number {
    return this.timeAt(performance.now());
  }

  set currentTime(time: number) {
    this.seek(time);
  }

  get playbackRate(): number {
    return this.rate;
  }

  set playbackRate(rate: number) {
    if (!(rate > 0) || rate === this.rate) return;
    const before = engineFor(this.rate, this.pitch);
    this.rate = rate;
    this.handOver(before);
  }

  get preservesPitch(): boolean {
    return this.pitch;
  }

  set preservesPitch(pitch: boolean) {
    if (pitch === this.pitch) return;
    const before = engineFor(this.rate, this.pitch);
    this.pitch = pitch;
    if (engineFor(this.rate, this.pitch) !== before) this.handOver(before);
  }

  /**
   * Decode `blob` and play it from now on, at the same position. The track it replaces is
   * dropped.
   */
  load(blob: Blob): Promise<void> {
    if (blob === this.blob && this.loadingTrack) return this.loadingTrack;
    this.blob = blob;
    const load = ++this.loads;
    const wasLoaded = this.buffer !== null;
    if (!wasLoaded) this.dispatchEvent(new Event("loadstart"));
    const sampleRate = this.context?.sampleRate ?? DEFAULT_SAMPLE_RATE;
    this.loadingTrack = this.decode(blob, sampleRate).then((buffer) => {
      if (load === this.loads) this.setBuffer(buffer);
    });
    return this.loadingTrack;
  }

  play(): Promise<void> {
    if (this.wanted) return Promise.resolve();
    this.wanted = true;
    if (!this.range && this.position >= this.duration) this.position = 0;
    this.dispatchEvent(new Event("play"));
    this.startFrames();
    return this.start();
  }

  pause() {
    if (!this.wanted) return;
    const playing = this.playing;
    // The audio rendered up to now still reaches the output, so playback resumes after it.
    if (playing) this.position = this.songTimeAtContextTime(playing, playing.context.currentTime);
    this.stopPlayback();
    this.dispatchEvent(new Event("timeupdate"));
    this.dispatchEvent(new Event("pause"));
  }

  /**
   * Play from `start` and stop at `end`, both on the audio clock, whether or not playback is
   * running.
   */
  playRange(start: number, end: number) {
    if (!(end > start)) return;
    this.range = { start, end };
    this.seek(start);
    if (!this.wanted) this.play();
  }

  /**
   * Play on past the end of the range being played.
   */
  clearRange() {
    if (!this.range) return;
    this.range = null;
    this.handOver(engineFor(this.rate, this.pitch));
  }

  /**
   * The song time heard at `at`, a `performance.now()` time such as an event's `timeStamp`.
   */
  timeAt(at: number): number {
    const playing = this.playing;
    if (!playing) return this.position;
    return this.songTimeAtContextTime(playing, this.heard(playing.context, at));
  }

  dispose() {
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.stopPlayback();
    this.loads++;
    this.closeContext();
  }

  private seek(time: number) {
    if (!Number.isFinite(time)) return;
    const duration = this.duration;
    time = Math.max(0, Number.isFinite(duration) ? Math.min(duration, time) : time);
    if (this.range && (time < this.range.start || time >= this.range.end)) this.range = null;
    this.position = time;
    if (this.playing) {
      this.stopNodes(this.playing, this.playing.context.currentTime);
      this.playing = null;
    }
    this.dispatchEvent(new Event("seeking"));
    if (this.wanted) this.start();
  }

  private setBuffer(buffer: AudioBuffer) {
    const playing = this.playing;
    if (playing?.fader && engineFor(this.rate, this.pitch) === "buffer") {
      this.crossfadeTo(playing, buffer);
      return;
    }
    if (playing) {
      this.position = this.songTimeAtContextTime(playing, playing.context.currentTime);
      this.stopNodes(playing, playing.context.currentTime);
      this.playing = null;
    }
    this.buffer = buffer;
    this.dispatchEvent(new Event("loadeddata"));
    if (this.wanted) this.start();
  }

  private closeContext() {
    clearTimeout(this.stretchTimer);
    this.context?.close().catch(() => {});
    this.context = null;
    this.stretch = null;
    this.stretchReady = null;
  }

  private onVisibilityChange = () => {
    if (document.visibilityState !== "hidden") return;
    if (!this.pauseWhenHidden && this.wanted) return;
    this.pause();
    this.closeContext();
  };

  /**
   * Start playing from `position` once the context, the track and, if needed, Signalsmith are
   * ready.
   */
  private async start() {
    const start = ++this.starts;
    try {
      const context = await this.readyContext();
      const engine = engineFor(this.rate, this.pitch);
      const stretch = engine === "stretch" ? await this.readyStretch(context) : null;
      if (start !== this.starts || !this.wanted || !this.buffer) return;
      const output = context.currentTime + SCHEDULE_AHEAD + (stretch?.latency ?? 0);
      this.begin(context, stretch, [{ input: this.position, output, rate: this.rate }]);
    } catch (error) {
      console.error("Could not start playback:", error);
      if (start === this.starts) this.pause();
    }
  }

  /**
   * Move playback over to the engine the rate and pitch now call for, at a time scheduled on the
   * audio clock, so that nothing plays twice and nothing is skipped.
   */
  private async handOver(before: Engine) {
    if (!this.wanted) return;
    const playing = this.playing;
    if (!playing) {
      this.start();
      return;
    }
    const start = ++this.starts;
    try {
      const engine = engineFor(this.rate, this.pitch);
      const stretch = engine === "stretch" ? await this.readyStretch(playing.context) : null;
      if (start !== this.starts || this.playing !== playing) return;
      const output = playing.context.currentTime + SCHEDULE_AHEAD + (stretch?.latency ?? 0);
      // Playback that ends before the handover is left to end.
      if (output >= playing.outputEnd) return;
      const input = songTimeAt(playing.spans, output);
      const spans = playing.spans.filter((span) => span.output < output);
      // Both engines being Signalsmith, the new schedule replaces the old one on the same node.
      if (!(before === "stretch" && engine === "stretch")) this.stopNodes(playing, output);
      this.begin(playing.context, stretch, [...spans, { input, output, rate: this.rate }]);
    } catch (error) {
      console.error("Could not change the playback rate:", error);
    }
  }

  /**
   * Fade `buffer` in over the buffer source playing, from the same song time, so the swap has
   * neither a gap nor a click. Playback about to end is left to end on the old track.
   */
  private crossfadeTo(playing: Playing, buffer: AudioBuffer) {
    const output = playing.context.currentTime + SCHEDULE_AHEAD;
    this.buffer = buffer;
    this.dispatchEvent(new Event("loadeddata"));
    if (output >= playing.outputEnd) return;
    const input = songTimeAt(playing.spans, output);
    const spans = playing.spans.filter((span) => span.output < output);
    const fadeEnd = output + SWAP_FADE_SECONDS;
    playing.fader?.gain.setValueAtTime(1, output);
    playing.fader?.gain.linearRampToValueAtTime(0, fadeEnd);
    playing.source?.stop(fadeEnd);
    this.begin(playing.context, null, [...spans, { input, output, rate: this.rate }], true);
  }

  /**
   * Play from the last of `spans` up to the range's end, or the track's, through `stretch` if
   * given and through a buffer source otherwise. A buffer source can fade in.
   */
  private begin(context: AudioContext, stretch: Stretch | null, spans: Span[], fadeIn = false) {
    const buffer = this.buffer as AudioBuffer;
    const { input, output, rate } = spans[spans.length - 1];
    const end = this.range?.end ?? buffer.duration;
    const outputEnd = output + Math.max(0, end - input) / rate;
    let source: AudioBufferSourceNode | null = null;
    let fader: GainNode | null = null;
    if (stretch) {
      this.scheduleStretch(context, stretch, input, output, rate, outputEnd);
    } else {
      source = context.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = rate;
      fader = context.createGain();
      if (fadeIn) {
        fader.gain.setValueAtTime(0, output);
        fader.gain.linearRampToValueAtTime(1, output + SWAP_FADE_SECONDS);
      }
      source.connect(fader);
      fader.connect(context.destination);
      source.start(output, input, Math.max(0, end - input));
    }
    const engine = stretch ? "stretch" : "buffer";
    this.playing = { context, engine, spans, end, outputEnd, source, fader };
  }

  private scheduleStretch(
    context: AudioContext,
    stretch: Stretch,
    input: number,
    output: number,
    rate: number,
    outputEnd: number,
  ) {
    const { gain } = stretch.gain;
    clearTimeout(this.stretchTimer);
    // Each schedule() call drops every change still to come, so the node can't be given the end
    // as well. The gain cuts the output on the audio clock instead.
    gain.cancelScheduledValues(output);
    gain.setValueAtTime(1, output);
    gain.setValueAtTime(0, outputEnd);
    stretch.node.schedule({ output, active: true, input, rate });
    this.stopStretchAfter(context, stretch, outputEnd);
  }

  /**
   * Stop what `playing` has scheduled at context time `at`.
   */
  private stopNodes(playing: Playing, at: number) {
    playing.source?.stop(at);
    const stretch = this.stretchReady;
    if (playing.engine !== "stretch" || !stretch) return;
    stretch.gain.gain.cancelScheduledValues(at);
    stretch.gain.gain.setValueAtTime(0, at);
    this.stopStretchAfter(playing.context, stretch, at);
  }

  private stopStretchAfter(context: AudioContext, stretch: Stretch, at: number) {
    clearTimeout(this.stretchTimer);
    const delay = (at - context.currentTime + STRETCH_IDLE_SECONDS) * 1000;
    // A stop drops every change still to come, so it mustn't outlive the next schedule.
    this.stretchTimer = setTimeout(() => stretch.node.stop(), delay);
  }

  private stopPlayback() {
    this.wanted = false;
    this.starts++;
    this.range = null;
    const playing = this.playing;
    if (playing) this.stopNodes(playing, playing.context.currentTime);
    this.playing = null;
    this.stopFrames();
  }

  /**
   * The context to play on, running, with the track decoded at its rate. It is created on the
   * first play, which browsers only allow to start from a user gesture, so it is resumed before
   * anything is awaited.
   */
  private async readyContext(): Promise<AudioContext> {
    this.context ??= this.createContext();
    const context = this.context;
    const resumed = context.resume();
    while (!this.buffer) {
      const pending = this.loadingTrack;
      if (!pending) throw new Error("No track to play");
      await pending;
      if (pending === this.loadingTrack && !this.buffer) throw new Error("No track to play");
    }
    await resumed;
    return context;
  }

  /**
   * The Signalsmith node for `context`, holding the current track.
   */
  private async readyStretch(context: AudioContext): Promise<Stretch> {
    const buffer = this.buffer as AudioBuffer;
    this.stretch ??= (async () => {
      const node = await this.createStretch(context, buffer.numberOfChannels);
      const gain = context.createGain();
      gain.gain.value = 0;
      node.connect(gain).connect(context.destination);
      const latency = await node.latency();
      return { node, gain, latency, buffer: null, loaded: Promise.resolve() };
    })();
    const pending = this.stretch;
    const stretch = await pending;
    if (stretch.buffer !== buffer) {
      stretch.buffer = buffer;
      stretch.loaded = this.loadStretch(stretch, buffer, context.sampleRate);
    }
    await stretch.loaded;
    if (pending === this.stretch) this.stretchReady = stretch;
    return stretch;
  }

  private async loadStretch(stretch: Stretch, buffer: AudioBuffer, sampleRate: number) {
    // Signalsmith reads the samples at the context's rate.
    const samples =
      buffer.sampleRate === sampleRate || !this.blob
        ? buffer
        : await this.decode(this.blob, sampleRate);
    await stretch.node.dropBuffers();
    const channels = [...Array(samples.numberOfChannels)].map((_, c) => samples.getChannelData(c));
    await stretch.node.addBuffers(channels);
  }

  private heard(context: AudioContext, at: number): number {
    return heardContextTime(
      context.getOutputTimestamp(),
      context.currentTime,
      context.outputLatency ?? 0,
      performance.now(),
      at,
    );
  }

  private songTimeAtContextTime(playing: Playing, time: number): number {
    if (time >= playing.outputEnd) return playing.end;
    return Math.min(playing.end, songTimeAt(playing.spans, time));
  }

  private startFrames() {
    if (this.frame) return;
    this.lastReported = -1;
    this.frame = requestAnimationFrame(this.onFrame);
  }

  private stopFrames() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  private onFrame = () => {
    this.frame = requestAnimationFrame(this.onFrame);
    const playing = this.playing;
    if (playing && this.heard(playing.context, performance.now()) >= playing.outputEnd) {
      this.finish(playing);
      return;
    }
    const time = this.currentTime;
    if (time === this.lastReported) return;
    this.lastReported = time;
    this.dispatchEvent(new Event("timeupdate"));
  };

  private finish(playing: Playing) {
    this.position = playing.end;
    this.stopPlayback();
    this.dispatchEvent(new Event("timeupdate"));
    this.dispatchEvent(new Event("ended"));
    this.dispatchEvent(new Event("pause"));
  }
}
