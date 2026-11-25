// Tempo (BPM) from audio: onset strength (spectral flux in a few bands),
// then the autocorrelation of that envelope, with a gentle preference for
// dance tempos so a song isn't read at half or double its speed.
import { spawn } from 'node:child_process';

const SR = 11025;
const HOP = 128; // ≈ 86 envelope frames per second
const N = 1024;

function pcm(file) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-']);
    const chunks = [];
    p.stdout.on('data', (c) => chunks.push(c));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg failed on ${file}`));
      const b = Buffer.concat(chunks);
      resolve(new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4)));
    });
  });
}

// in-place radix-2 FFT
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len;
    const wr = Math.cos(a);
    const wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

// Onset strength through the song (pulses only, trend removed), plus the samples.
export async function onsets(file) {
  const x = await pcm(file);
  const frames = Math.floor((x.length - N) / HOP);
  const win = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  const bins = N / 2;
  let prev = new Float32Array(bins);
  const env = new Float32Array(frames);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < N; i++) {
      re[i] = x[f * HOP + i] * win[i];
      im[i] = 0;
    }
    fft(re, im);
    const cur = new Float32Array(bins);
    let flux = 0;
    for (let b = 1; b < bins; b++) {
      cur[b] = Math.log1p(100 * Math.hypot(re[b], im[b]));
      const d = cur[b] - prev[b];
      // the kick and bass count a little more: that's where the beat usually is
      if (d > 0) flux += d * (b < 24 ? 2 : 1);
    }
    env[f] = flux;
    prev = cur;
  }
  // remove the slow trend so only the pulses remain
  const fps = SR / HOP;
  const w = Math.round(fps * 0.5);
  const o = new Float32Array(frames);
  let sum = 0;
  for (let i = 0; i < frames; i++) {
    sum += env[i];
    if (i >= w) sum -= env[i - w];
    o[i] = Math.max(0, env[i] - sum / Math.min(i + 1, w));
  }
  // frame f is centred N/2 samples after its start
  return { o, fps, x, sr: SR, offset: N / 2 / SR };
}

export async function tempo(file) {
  const { o, fps } = await onsets(file);
  const frames = o.length;
  // autocorrelation over 60–200 bpm, weighted towards ~125 bpm
  const score = (bpm) => {
    const lag = (60 / bpm) * fps;
    const l0 = Math.floor(lag);
    const fr = lag - l0;
    let s = 0;
    for (let i = 0; i + l0 + 1 < frames; i++) s += o[i] * (o[i + l0] * (1 - fr) + o[i + l0 + 1] * fr);
    return s;
  };
  let best = 0;
  let bestBpm = 0;
  const raw = [];
  for (let bpm = 60; bpm <= 200; bpm += 0.25) {
    const s = score(bpm) + 0.5 * score(bpm * 2 > 200 ? bpm / 2 : bpm * 2); // beats line up with their double/half too
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 125) / 0.55) ** 2);
    raw.push([bpm, s]);
    if (s * prior > best) {
      best = s * prior;
      bestBpm = bpm;
    }
  }
  return Math.round(bestBpm);
}
