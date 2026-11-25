import type { TimedLyric } from '../lyric-timing';
import { recordTimelines, segmentAt, type RecordPosition } from './record';

export interface BoothTrack {
  id: string;
  title: string;
  release: string;
  src: string;
  url: string;
  duration: number;
  cover?: string;
  label?: string;
  album: string;
  bpm?: number;
  peaks: number[];
  waveform?: number[];
  lyrics?: TimedLyric[];
}

export interface BoothRelease {
  id: string;
  title: string;
  cover?: string;
  label?: string;
  back?: string;
  catalog: string;
}

export const effects = ['off', 'delay', 'reverb', 'drive', 'crush', 'grain', 'repeat'] as const;
export const effectLabels = ['Off', 'Delay', 'Reverb', 'Distortion', 'Bitcrush', 'Granular', 'Beat repeat'];
type Effect = typeof effects[number];

export const channelControls = {
  gain: { label: 'Trim', min: 0, max: 2, step: 0.01, initial: 1 },
  high: { label: 'High EQ', min: -18, max: 12, step: 0.1, initial: 0 },
  mid: { label: 'Mid EQ', min: -18, max: 12, step: 0.1, initial: 0 },
  low: { label: 'Low EQ', min: -18, max: 12, step: 0.1, initial: 0 },
  hp: { label: 'High-pass', min: 0, max: 1, step: 0.01, initial: 0 },
  lp: { label: 'Low-pass', min: 0, max: 1, step: 0.01, initial: 1 },
  volume: { label: 'Channel fader', min: 0, max: 1, step: 0.01, initial: 0.86 },
} as const;

export type ChannelControl = keyof typeof channelControls;
export const mixDefaults = { master: 0.85, cross: 0 } as const;
export type Side = 0 | 1;
export type WaveformScope = 'track' | 'record';
const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value));
const defaults = () => Object.fromEntries(Object.entries(channelControls).map(([key, spec]) => [key, spec.initial])) as Record<ChannelControl, number>;

export const waveformPoints = 240;

function decodedWaveform(frames: Float32Array[]) {
  const length = frames[0].length;
  const levels = Array.from({ length: waveformPoints }, (_, i) => {
    const first = Math.floor(i * length / waveformPoints);
    const end = Math.floor((i + 1) * length / waveformPoints);
    const stride = Math.max(1, Math.floor((end - first) / 128));
    let level = 0;
    for (const channel of frames) {
      for (let sample = first; sample < end; sample += stride) {
        level = Math.max(level, Math.abs(channel[sample]));
      }
    }
    return level;
  });
  const peak = Math.max(...levels);
  return peak > 0 ? levels.map(level => level / peak) : levels;
}

function preference<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem('ps:booth:' + key) ?? 'null') ?? fallback; }
  catch { return fallback; }
}

function remember(key: string, value: unknown) {
  try { localStorage.setItem('ps:booth:' + key, JSON.stringify(value)); } catch {}
}

interface DeckNodes {
  source: AudioWorkletNode;
  trim: GainNode;
  filters: Record<'low' | 'mid' | 'high' | 'hp' | 'lp', BiquadFilterNode>;
  dry: GainNode;
  wet: Record<'delay' | 'reverb' | 'drive', GainNode>;
  delay: DelayNode;
  channel: GainNode;
  cross: GainNode;
  cue: GainNode;
}

class Deck {
  track?: BoothTrack;
  waveform?: number[];
  waveformScope: WaveformScope = 'track';
  loading = false;
  error = '';
  playing = false;
  ended = false;
  time = 0;
  duration = 0;
  angle = 0;
  angleAt = 0;
  rate = 0;
  cuePoint?: number;
  loopIn?: number;
  loopOut?: number;
  loop = false;
  monitoring = false;
  version = 0;
  request?: AbortController;
  nodes?: DeckNodes;
  controls = defaults();
  effect: Effect = 'off';
  pitch = 0;
  rpm = 33;
  scratchTimer?: number;
}

type SinkAudio = HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
type OutputDevices = MediaDevices & { selectAudioOutput?: () => Promise<MediaDeviceInfo> };

class BoothAudio extends EventTarget {
  decks = [new Deck(), new Deck()] as const;
  active: Side | null = null;
  master: number = mixDefaults.master;
  cross: number = mixDefaults.cross;
  siteLevel = 1;
  spectrum?: AnalyserNode;
  private masterMeters: { analyser: AnalyserNode; samples: Float32Array<ArrayBuffer> }[] = [];
  private records = recordTimelines([]);

  set library(tracks: BoothTrack[]) {
    this.records = recordTimelines(tracks);
  }
  handover = 0;
  private context?: AudioContext;
  private ready?: Promise<void>;
  private mix?: GainNode;
  private output?: GainNode;
  private cueBus?: MediaStreamAudioDestinationNode;
  private cueAudio?: SinkAudio;
  private monitorReady = false;
  private resumeSides: Side[] = [];
  private stopTimer?: number;
  private mixStream?: MediaStreamAudioDestinationNode;
  private recorder?: MediaRecorder;
  recording = false;

  constructor() {
    super();
    const saved = preference('settings', { master: this.master, cross: this.cross, channels: this.decks.map(d => d.controls) });
    this.master = saved.master;
    this.cross = saved.cross;
    this.decks.forEach((deck, i) => Object.assign(deck.controls, saved.channels?.[i]));
  }

  private settings() {
    remember('settings', { master: this.master, cross: this.cross, channels: this.decks.map(d => d.controls) });
  }

  changed() { this.dispatchEvent(new Event('change')); }

  private set(node: AudioParam, value: number) {
    node.setTargetAtTime(value, this.context!.currentTime, 0.012);
  }

  private async unlock() {
    if (!this.context) this.context = new AudioContext({ latencyHint: 'interactive' });
    const context = this.context;
    clearTimeout(this.stopTimer);
    const resume = context.resume();
    this.ready ??= this.createGraph(context).catch(error => {
      this.ready = undefined;
      throw error;
    });
    await Promise.all([resume, this.ready]);
  }

  private async createGraph(context: AudioContext) {
    await context.audioWorklet.addModule('/booth-processor.js');
    const mix = context.createGain();
    const output = context.createGain();
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 4;
    limiter.ratio.value = 14;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.16;
    this.spectrum = context.createAnalyser();
    this.spectrum.fftSize = 4096;
    mix.connect(limiter).connect(output).connect(this.spectrum).connect(context.destination);
    const stereo = output.connect(context.createChannelSplitter(2));
    this.masterMeters = [0, 1].map(channel => {
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      stereo.connect(analyser, channel);
      return { analyser, samples: new Float32Array(analyser.fftSize) };
    });
    this.mix = mix;
    this.output = output;
    this.mixStream = context.createMediaStreamDestination();
    limiter.connect(this.mixStream);
    this.cueBus = context.createMediaStreamDestination();

    const impulse = context.createBuffer(2, Math.floor(context.sampleRate * 1.5), context.sampleRate);
    for (let channel = 0; channel < impulse.numberOfChannels; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 3;
    }

    this.decks.forEach((deck, side) => {
      const source = new AudioWorkletNode(context, 'ps-turntable', { numberOfInputs: 0, outputChannelCount: [2] });
      const trim = context.createGain();
      const filter = (type: BiquadFilterType, frequency: number, q = 0.707) => {
        const node = context.createBiquadFilter();
        node.type = type;
        node.frequency.value = frequency;
        node.Q.value = q;
        return node;
      };
      const filters = {
        low: filter('lowshelf', 220), mid: filter('peaking', 1050), high: filter('highshelf', 3700),
        hp: filter('highpass', 10), lp: filter('lowpass', 22000),
      };
      const dry = context.createGain();
      const wet = { delay: context.createGain(), reverb: context.createGain(), drive: context.createGain() };
      const delay = context.createDelay(2);
      const echo = context.createGain();
      echo.gain.value = 0.42;
      delay.connect(echo).connect(delay);
      const reverb = context.createConvolver();
      reverb.buffer = impulse;
      const drive = context.createWaveShaper();
      drive.curve = Float32Array.from({ length: 2048 }, (_, i) => Math.tanh((i / 1023.5 - 1) * 5) * 0.72);
      drive.oversample = '2x';

      const postFx = context.createGain();
      const channel = context.createGain();
      const cross = context.createGain();
      const cue = context.createGain();
      cue.gain.value = 0;
      source.connect(trim).connect(filters.low).connect(filters.mid).connect(filters.high).connect(filters.hp).connect(filters.lp);
      const filtered = filters.lp;
      filtered.connect(dry).connect(postFx);
      filtered.connect(delay).connect(wet.delay).connect(postFx);
      filtered.connect(reverb).connect(wet.reverb).connect(postFx);
      filtered.connect(drive).connect(wet.drive).connect(postFx);
      postFx.connect(channel).connect(cross).connect(mix);
      postFx.connect(cue).connect(this.cueBus!);
      deck.nodes = { source, trim, filters, dry, wet, delay, channel, cross, cue };
      source.port.onmessage = ({ data }) => {
        if (data.epoch !== deck.version) return;
        deck.time = data.time;
        deck.angle = data.angle;
        deck.angleAt = performance.now();
        deck.rate = data.rate;
        if (data.ended) {
          deck.ended = true;
          deck.playing = false;
          const next = this.neighbor(side as Side, 1);
          if (next) {
            void this.load(side as Side, next, { play: true, focus: false });
            return;
          }
          if (this.active === side && this.decks[side === 0 ? 1 : 0].playing) this.active = side === 0 ? 1 : 0;
          this.sleepWhenIdle();
          this.changed();
        }
      };
      for (const key of Object.keys(channelControls) as ChannelControl[]) this.applyChannel(deck, key);
      this.applyEffect(deck, true);
    });
    this.applyMix();
  }

  private send(deck: Deck, type: string, value: unknown) { deck.nodes?.source.port.postMessage({ type, value }); }

  async load(side: Side, track: BoothTrack, options: { start?: number | ((duration: number) => number); play?: boolean; focus?: boolean } = {}) {
    const { start = 0, play = false, focus = true } = options;
    const deck = this.decks[side];
    const version = ++deck.version;
    const handover = this.handover;
    deck.request?.abort();
    const request = new AbortController();
    deck.request = request;
    this.releaseScratch(side);
    deck.nodes?.source.port.postMessage({ type: 'eject', epoch: version });
    Object.assign(deck, {
      track, waveform: undefined, time: typeof start === 'number' ? start : start(track.duration), duration: track.duration, playing: false, ended: false, loading: true, error: '',
      cuePoint: undefined, loopIn: undefined, loopOut: undefined, loop: false, rate: 0, angle: 0,
    });
    this.changed();
    try {
      await this.unlock();
      const response = await fetch(track.src, { signal: request.signal });
      if (!response.ok) throw new Error(`Audio unavailable (${response.status})`);
      const bytes = await response.arrayBuffer();
      if (version !== deck.version) return;
      const buffer = await this.context!.decodeAudioData(bytes);
      if (version !== deck.version) return;
      const frames = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, i) => buffer.getChannelData(i).slice());
      if (!track.waveform?.length && !track.peaks.length) deck.waveform = decodedWaveform(frames);
      const time = clamp(typeof start === 'number' ? start : start(buffer.duration), 0, Math.max(0, buffer.duration - 0.001));
      deck.time = time;
      deck.nodes!.source.port.postMessage({ type: 'load', epoch: version, frames, position: time }, frames.map(frame => frame.buffer));
      deck.duration = buffer.duration;
      deck.loading = false;
      this.applyRate(deck);
      this.applyEffect(deck);
      if (play && handover === this.handover) this.setPlaying(side, true, focus);
    } catch (error) {
      if (version !== deck.version || request.signal.aborted) return;
      deck.error = error instanceof Error ? error.message : 'Audio unavailable';
      deck.loading = false;
    }
    this.sleepWhenIdle();
    this.changed();
  }

  recordPosition(side: Side, selected?: BoothTrack): RecordPosition | undefined {
    const deck = this.decks[side];
    const track = deck.track ?? selected;
    if (!track) return;
    const record = this.records.get(track.album);
    const segment = record?.segments.find(entry => entry.track.id === track.id);
    if (!record || !segment) return;
    const fraction = deck.track && deck.duration ? clamp(deck.time / deck.duration, 0, 1) : 0;
    return { record, segment, time: segment.offset + fraction * segment.duration };
  }

  setWaveformScope(side: Side, scope: WaveformScope) {
    this.decks[side].waveformScope = scope;
    this.changed();
  }

  seekRecord(side: Side, time: number, selected?: BoothTrack) {
    const deck = this.decks[side];
    if (deck.loading) return;
    const position = this.recordPosition(side, selected);
    if (!position) return;
    const segment = segmentAt(position.record, time);
    if (!segment || segment.duration <= 0) return;
    const fraction = clamp((time - segment.offset) / segment.duration, 0, 1);
    if (deck.track?.id === segment.track.id && !deck.error) {
      const target = fraction * deck.duration;
      if (deck.loop && deck.loopIn !== undefined && deck.loopOut !== undefined && (target < deck.loopIn || target >= deck.loopOut)) {
        this.toggleLoop(side);
      }
      this.seek(side, target);
      return;
    }
    void this.load(side, segment.track, { start: duration => fraction * duration, play: deck.playing, focus: false });
  }

  neighbor(side: Side, offset: number, track = this.decks[side].track) {
    if (!track) return;
    const segments = this.records.get(track.album)?.segments;
    const current = segments?.findIndex(segment => segment.track.id === track.id) ?? -1;
    if (current >= 0) return segments?.[current + offset]?.track;
  }

  setPlaying(side: Side, playing: boolean, focus = true) {
    const deck = this.decks[side];
    if (!deck.track || deck.loading || deck.error || !deck.nodes) return;
    if (playing) {
      clearTimeout(this.stopTimer);
      void this.context?.resume().catch(() => {});
      if (deck.ended) this.seek(side, 0);
      if (focus || this.active === null) this.active = side;
      this.resumeSides = [];
    }
    deck.playing = playing;
    this.send(deck, 'play', playing);
    if (!playing) {
      const other = side === 0 ? 1 : 0;
      if (this.active === side && this.decks[other].playing) this.active = other;
      this.sleepWhenIdle();
    }
    this.changed();
  }

  pauseMix() {
    this.handover++;
    for (const side of [0, 1] as const) {
      const deck = this.decks[side];
      if (!deck.playing) continue;
      this.resumeSides.push(side);
      deck.playing = false;
      this.send(deck, 'play', false);
    }
    this.sleepWhenIdle();
    this.changed();
  }

  playMix() {
    if (this.active === null) return;
    const sides = this.resumeSides.length ? [...this.resumeSides] : [this.active];
    const focus = this.active;
    for (const side of sides) if (side !== focus) this.setPlaying(side, true);
    this.setPlaying(focus, true);
  }

  private sleepWhenIdle() {
    clearTimeout(this.stopTimer);
    if (this.decks.some(deck => deck.playing || deck.loading) || this.recording || this.monitorReady) return;
    this.stopTimer = window.setTimeout(() => {
      if (this.context?.state === 'running') void this.context.suspend().catch(() => {});
    }, 3500);
  }

  leaveForSite() {
    this.handover++;
    if (this.active === null) return;
    this.active = null;
    this.resumeSides = [];
    for (const [side, deck] of this.decks.entries()) {
      this.releaseScratch(side as Side);
      deck.playing = false;
      this.send(deck, 'play', false);
    }
    this.sleepWhenIdle();
    this.changed();
  }

  click() {
    const context = this.context;
    if (context?.state !== 'running' || !this.output || this.master <= 0) return;
    const oscillator = context.createOscillator();
    const level = context.createGain();
    const start = context.currentTime;
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(530, start);
    oscillator.frequency.exponentialRampToValueAtTime(115, start + 0.02);
    level.gain.setValueAtTime(0.015 * this.master, start);
    level.gain.exponentialRampToValueAtTime(0.0001, start + 0.026);
    oscillator.connect(level).connect(this.output);
    oscillator.start(start);
    oscillator.stop(start + 0.03);
  }

  seek(side: Side, time: number) {
    const deck = this.decks[side];
    if (deck.loading) return;
    deck.ended = false;
    deck.time = clamp(time, 0, Math.max(0, deck.duration - 0.001));
    this.send(deck, 'seek', deck.time);
  }

  lift(side: Side, raised: boolean) {
    this.send(this.decks[side], 'lift', raised);
  }

  scratch(side: Side, rate: number, burstMs?: number) {
    const deck = this.decks[side];
    if (deck.loading || deck.error || !deck.track) return;
    clearTimeout(this.stopTimer);
    if (this.context?.state === 'suspended') void this.context.resume().catch(() => {});
    if (this.active === null) {
      this.active = side;
      this.changed();
    }
    this.send(deck, 'scratch', clamp(rate, -8, 8));
    clearTimeout(deck.scratchTimer);
    deck.scratchTimer = window.setTimeout(() => {
      if (burstMs) this.releaseScratch(side);
      else this.send(deck, 'scratch', 0);
    }, burstMs ?? 55);
  }

  releaseScratch(side: Side) {
    const deck = this.decks[side];
    clearTimeout(deck.scratchTimer);
    this.send(deck, 'scratch', null);
    this.sleepWhenIdle();
  }

  setPitch(side: Side, pitch: number) {
    const deck = this.decks[side];
    deck.pitch = clamp(pitch, -16, 16);
    this.applyRate(deck);
    this.changed();
  }

  toggleRpm(side: Side) {
    const deck = this.decks[side];
    deck.rpm = deck.rpm === 33 ? 45 : 33;
    this.applyRate(deck);
    this.changed();
  }

  speed(side: Side) {
    const deck = this.decks[side];
    return (1 + deck.pitch / 100) * (deck.rpm === 45 ? 1.35 : 1);
  }

  private applyRate(deck: Deck) {
    this.send(deck, 'rate', this.speed(deck === this.decks[0] ? 0 : 1));
    if (deck.nodes) this.set(deck.nodes.delay.delayTime, clamp(45 / ((deck.track?.bpm || 120) * this.speed(deck === this.decks[0] ? 0 : 1)), 0.08, 1.3));
  }

  cue(side: Side) {
    const deck = this.decks[side];
    if (!deck.track || deck.loading) return;
    if (deck.cuePoint === undefined) deck.cuePoint = deck.time;
    else this.seek(side, deck.cuePoint);
    this.changed();
  }

  setCue(side: Side) {
    const deck = this.decks[side];
    if (!deck.track || deck.loading) return;
    deck.cuePoint = deck.time;
    this.changed();
  }

  markLoop(side: Side, point: 'in' | 'out') {
    const deck = this.decks[side];
    if (!deck.track || deck.loading) return;
    if (point === 'in') {
      deck.loopIn = deck.time;
      deck.loopOut = undefined;
    } else {
      deck.loopOut = deck.time;
    }
    deck.loop = deck.loopIn !== undefined && deck.loopOut !== undefined && deck.loopOut - deck.loopIn > 0.05;
    this.applyLoop(deck);
  }

  toggleLoop(side: Side) {
    const deck = this.decks[side];
    if (!deck.track || deck.loading || deck.duration < 0.1) return;
    if (deck.loopIn === undefined || deck.loopOut === undefined || deck.loopOut - deck.loopIn <= 0.05) {
      deck.loopIn = Math.min(deck.time, deck.duration - 0.1);
      deck.loopOut = Math.min(deck.duration, deck.loopIn + 240 / (deck.track.bpm || 120));
    }
    deck.loop = !deck.loop;
    if (deck.loop && (deck.time < deck.loopIn || deck.time >= deck.loopOut)) this.seek(side, deck.loopIn);
    this.applyLoop(deck);
  }

  private applyLoop(deck: Deck) {
    this.send(deck, 'loop', deck.loop ? [deck.loopIn, deck.loopOut] : null);
    this.changed();
  }

  setChannel(side: Side, key: ChannelControl, value: number) {
    const spec = channelControls[key];
    const deck = this.decks[side];
    deck.controls[key] = clamp(value, spec.min, spec.max);
    this.applyChannel(deck, key);
    this.settings();
    this.changed();
  }

  private applyChannel(deck: Deck, key: ChannelControl) {
    const node = deck.nodes;
    if (!node) return;
    const value = deck.controls[key];
    if (key === 'gain') this.set(node.trim.gain, value);
    else if (key === 'volume') this.set(node.channel.gain, value);
    else if (key === 'hp') this.set(node.filters.hp.frequency, 10 * 190 ** value);
    else if (key === 'lp') this.set(node.filters.lp.frequency, 90 * 240 ** value);
    else this.set(node.filters[key].gain, value);
  }

  setEffect(side: Side, index: number) {
    const deck = this.decks[side];
    deck.effect = effects[index] ?? 'off';
    this.applyEffect(deck);
    this.changed();
  }

  private applyEffect(deck: Deck, immediate = false) {
    const nodes = deck.nodes;
    if (!nodes) return;
    const set = (param: AudioParam, value: number) => {
      if (immediate) param.value = value;
      else this.set(param, value);
    };
    for (const [name, node] of Object.entries(nodes.wet)) set(node.gain, name === deck.effect ? (name === 'drive' ? 0.85 : 0.43) : 0);
    set(nodes.dry.gain, deck.effect === 'drive' ? 0.25 : 1);
    this.applyRate(deck);
    nodes.source.port.postMessage({ type: 'effect', value: deck.effect, beat: 60 / (deck.track?.bpm || 120) });
  }

  setMix(key: 'cross' | 'master', value: number) {
    this[key] = clamp(value, key === 'cross' ? -1 : 0, 1);
    this.applyMix();
    this.settings();
    this.changed();
  }

  setSiteLevel(value: number) {
    this.siteLevel = value;
    this.applyMix();
  }

  private applyMix() {
    if (!this.mix || !this.output) return;
    this.set(this.mix.gain, this.master);
    this.set(this.output.gain, this.siteLevel);
    this.decks.forEach((deck, i) => this.set(deck.nodes!.cross.gain, i === 0 ? Math.cos((this.cross + 1) * Math.PI / 4) : Math.sin((this.cross + 1) * Math.PI / 4)));
  }

  masterLevels(channel: Side) {
    const meter = this.masterMeters[channel];
    if (!meter) return { rms: 0, peak: 0 };
    const { analyser, samples } = meter;
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    let peak = 0;
    for (const sample of samples) {
      sum += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
    }
    return { rms: Math.sqrt(sum / samples.length), peak };
  }

  get canMonitor() {
    return !!(navigator.mediaDevices as OutputDevices | undefined)?.selectAudioOutput ||
      !!(HTMLMediaElement.prototype as SinkAudio).setSinkId;
  }

  async outputs() {
    return (await navigator.mediaDevices?.enumerateDevices())?.filter(device => device.kind === 'audiooutput' && device.deviceId && device.deviceId !== 'default' && device.deviceId !== 'communications') ?? [];
  }

  async selectMonitor(id?: string) {
    const devices = navigator.mediaDevices as OutputDevices | undefined;
    const selected = id || (await devices?.selectAudioOutput?.())?.deviceId;
    if (!selected || selected === 'default') throw new Error('Select a separate headphone output.');
    await this.unlock();
    const audio = this.cueAudio ?? new Audio() as SinkAudio;
    if (!audio.setSinkId) throw new Error('This browser cannot route a separate cue output.');
    await audio.setSinkId(selected);
    audio.srcObject = this.cueBus!.stream;
    await audio.play();
    this.cueAudio = audio;
    this.monitorReady = true;
    this.changed();
  }

  toggleMonitor(side: Side) {
    if (!this.monitorReady) return false;
    const deck = this.decks[side];
    deck.monitoring = !deck.monitoring;
    this.set(deck.nodes!.cue.gain, Number(deck.monitoring) * 0.7);
    this.changed();
    return true;
  }

  async record(onComplete: (file: Blob) => void) {
    if (this.recorder?.state === 'recording') {
      this.recorder.stop();
      return;
    }
    await this.unlock();
    if (!this.mixStream) return;
    const format = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(this.mixStream.stream, format ? { mimeType: format } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = () => {
      this.recording = false;
      this.sleepWhenIdle();
      this.changed();
      onComplete(new Blob(chunks, { type: recorder.mimeType }));
    };
    recorder.onerror = () => {
      this.recording = false;
      this.sleepWhenIdle();
      this.changed();
    };
    recorder.start(1000);
    this.recorder = recorder;
    this.recording = true;
    this.changed();
  }
}

let singleton: BoothAudio | undefined;
export const boothAudio = () => singleton ??= new BoothAudio();
export const activeBooth = () => singleton?.active == null ? undefined : singleton;

export function playbackTransport(native: HTMLAudioElement) {
  return {
    get currentTime() { return getDeck()?.time ?? native.currentTime; },
    set currentTime(time) {
      const booth = activeBooth();
      if (booth) booth.seek(booth.active!, time);
      else native.currentTime = time;
    },
    get duration() { return getDeck()?.duration ?? native.duration; },
    get paused() { return activeBooth()?.decks.every(deck => !deck.playing) ?? native.paused; },
    get src() { return getDeck()?.track?.src ?? native.src; },
    get available() { return !!getDeck() || (!native.ended && !native.error); },
    play() {
      const booth = activeBooth();
      if (booth) booth.playMix();
      else return native.play();
      return Promise.resolve();
    },
    pause() {
      const booth = activeBooth();
      if (booth) booth.pauseMix();
      else native.pause();
    },
  };
}

function getDeck() {
  const booth = activeBooth();
  return booth?.decks[booth.active!];
}
