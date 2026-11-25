class TurntableProcessor extends AudioWorkletProcessor {
  frames = [];
  position = 0;
  rate = 0;
  running = false;
  scratch = null;
  lifted = false;
  angle = 0;
  gain = 0;
  report = 0;
  effect = 'off';
  beat = 0.5;
  effectStart = 0;
  effectClock = 0;
  grainStart = 0;
  epoch = 0;
  loop = null;
  deckRate = 1;

  constructor() {
    super();
    this.port.onmessage = ({ data }) => {
      switch (data.type) {
        case 'load':
          this.frames = data.frames;
          this.epoch = data.epoch;
          this.position = data.position * sampleRate;
          this.position = Math.min(this.position, this.frames[0].length - 1);
          this.rate = this.gain = this.angle = 0;
          this.running = this.lifted = false;
          this.loop = this.scratch = null;
          break;
        case 'eject':
          this.frames = [];
          this.epoch = data.epoch;
          this.position = this.rate = this.gain = this.angle = 0;
          this.running = this.lifted = false;
          this.loop = this.scratch = null;
          break;
        case 'play': this.running = data.value; break;
        case 'rate': this.deckRate = data.value; break;
        case 'seek':
          this.position = data.value * sampleRate;
          this.effectClock = 0;
          break;
        case 'scratch': this.scratch = data.value; break;
        case 'lift': this.lifted = data.value; break;
        case 'loop': this.loop = data.value?.map(seconds => seconds * sampleRate); break;
        case 'effect':
          this.effect = data.value;
          this.beat = data.beat || 0.5;
          this.effectClock = 0;
          break;
      }
    };
  }

  sample(frames, at) {
    const index = Math.floor(at);
    const a = frames[index] || 0;
    return a + ((frames[index + 1] || 0) - a) * (at - index);
  }

  process(_, [outputs]) {
    const length = this.frames[0]?.length || 0;
    let ended = false;
    const effectFrames = Math.max(250, Math.round(sampleRate * this.beat / this.deckRate));
    for (let i = 0; i < outputs[0].length && length; i++) {
      const target = this.scratch ?? (this.running ? this.deckRate : 0);
      const ease = this.scratch !== null ? 0.008 : (this.running ? 30 : 13) / sampleRate;
      this.rate += (target - this.rate) * ease;
      if (!this.lifted && this.loop && this.scratch === null && this.position >= this.loop[1]) {
        this.position = this.loop[0] + (this.position - this.loop[1]) % (this.loop[1] - this.loop[0]);
      }
      if (!this.lifted && this.position >= length - 1 && this.rate > 0) {
        this.position = length - 1;
        ended = this.running;
        this.running = false;
        this.rate = 0;
      }
      if (this.position <= 0 && this.rate < 0) this.rate = 0;
      const moving = this.lifted ? 0 : Math.min(1, Math.abs(this.rate) * 16);
      this.gain += (moving - this.gain) * 0.012;
      let read = this.position;
      let blend = 1;
      let previous = read;
      if (this.effect === 'repeat') {
        const phase = this.effectClock % effectFrames;
        if (!this.effectClock) this.effectStart = read;
        read = this.effectStart + phase * this.deckRate;
        previous = this.effectStart + Math.max(0, effectFrames - 42 + phase) * this.deckRate;
        blend = Math.min(1, phase / 42);
      }
      if (this.effect === 'grain') {
        const grain = Math.floor(effectFrames / 5);
        const phase = this.effectClock % grain;
        if (!phase) this.grainStart = Math.max(0, read - Math.random() * grain * 4);
        read = this.grainStart + phase * 1.15;
        blend = Math.min(1, phase / 100, (grain - phase) / 100);
      }
      if (moving > 0) this.effectClock++;
      for (let channel = 0; channel < outputs.length; channel++) {
        const frames = this.frames[channel] ?? this.frames[0];
        let value = this.sample(frames, read) * blend + this.sample(frames, previous) * (1 - blend);
        if (this.effect === 'crush') {
          if (this.effectClock % 5 === 0 || this.held?.[channel] === undefined) {
            this.held ??= [];
            this.held[channel] = Math.round(value * 28) / 28;
          }
          value = this.held[channel];
        }
        outputs[channel][i] = value * this.gain;
      }
      if (!this.lifted) this.position = Math.min(length - 1, Math.max(0, this.position + this.rate));
      this.angle = (this.angle + this.rate * (100 / 3) / 60 * Math.PI * 2 / sampleRate) % (Math.PI * 2);
    }
    if (ended || ++this.report >= 8) {
      this.report = 0;
      this.port.postMessage({ epoch: this.epoch, time: this.position / sampleRate, angle: this.angle, rate: this.rate, ended });
    }
    return true;
  }
}

registerProcessor('ps-turntable', TurntableProcessor);
