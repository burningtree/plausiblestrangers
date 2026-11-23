#!/usr/bin/env node
// Sound analysis for every track and archive song with audio.
//
//   npm run analyse            # analyse tracks not done yet
//   npm run analyse -- --force # redo all
//
// Per track, from the audio file (via ffmpeg):
//   - spectrogram: COLS time slices × BANDS log-spaced bands (40 Hz–11 kHz), 0–255
//   - balance: share of energy in sub / bass / low-mid / mid / high
//   - brightness (spectral centroid, Hz), stereo width (0–1), peak (dBFS)
//   - loudness (integrated LUFS) and loudness range (LU), via ffmpeg's ebur128
//   - the busiest moment (seconds), where the spectrum is fullest
// Writes src/data/analysis.json.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src/data/analysis.json');
const FORCE = process.argv.includes('--force');
const SR = 22050;
const N = 2048; // FFT size
const COLS = 240;
const BANDS = 40;
const F_LO = 40;
const F_HI = 11000;
const DB_FLOOR = -100; // spectrogram scale, absolute so songs compare
const DB_CEIL = -20;

function run(cmd, args, { capture = 'stdout' } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    let err = '';
    p.stdout.on('data', (c) => out.push(c));
    p.stderr.on('data', (c) => (err += c));
    p.on('close', (code) =>
      code === 0 ? resolve(capture === 'stderr' ? err : Buffer.concat(out)) : reject(new Error(err.slice(-400))),
    );
  });
}

// in-place iterative radix-2 FFT
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
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

const hann = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
const binHz = SR / N;
const bandEdges = Array.from({ length: BANDS + 1 }, (_, i) => F_LO * Math.pow(F_HI / F_LO, i / BANDS));
const BAL = [
  ['sub', 20, 60],
  ['bass', 60, 250],
  ['low-mid', 250, 1000],
  ['mid', 1000, 4000],
  ['high', 4000, 11025],
];

async function analyse(file) {
  const raw = await run('ffmpeg', ['-v', 'error', '-i', file, '-ac', '2', '-ar', String(SR), '-f', 'f32le', '-']);
  const st = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 4));
  const frames = st.length / 2;
  const mono = new Float32Array(frames);
  let sLL = 0, sRR = 0, sLR = 0, peak = 0;
  for (let i = 0; i < frames; i++) {
    const l = st[2 * i];
    const r = st[2 * i + 1];
    mono[i] = (l + r) / 2;
    sLL += l * l;
    sRR += r * r;
    sLR += l * r;
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
  }
  const corr = sLR / Math.sqrt(sLL * sRR || 1);

  // spectrogram: average 4 FFT windows per time slice
  const spec = new Uint8Array(COLS * BANDS);
  const balance = new Float64Array(BAL.length);
  let centroidNum = 0, centroidDen = 0;
  const fullness = new Float32Array(COLS);
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const per = 4;
  for (let c = 0; c < COLS; c++) {
    const start = Math.floor((c / COLS) * (frames - N));
    const span = Math.floor(frames / COLS);
    const bandPow = new Float64Array(BANDS);
    for (let w = 0; w < per; w++) {
      const off = start + Math.floor((w / per) * Math.max(0, span - N));
      for (let i = 0; i < N; i++) {
        re[i] = (mono[off + i] ?? 0) * hann[i];
        im[i] = 0;
      }
      fft(re, im);
      for (let k = 1; k < N / 2; k++) {
        const f = k * binHz;
        const p = (re[k] * re[k] + im[k] * im[k]) / (N * N);
        centroidNum += f * p;
        centroidDen += p;
        for (let b = 0; b < BAL.length; b++) if (f >= BAL[b][1] && f < BAL[b][2]) balance[b] += p;
        if (f < F_LO || f >= F_HI) continue;
        let bi = 0;
        while (bi < BANDS - 1 && f >= bandEdges[bi + 1]) bi++;
        bandPow[bi] += p / per;
      }
    }
    let full = 0;
    for (let b = 0; b < BANDS; b++) full += bandPow[b];
    for (let b = 0; b < BANDS; b++) {
      const db = 10 * Math.log10(bandPow[b] + 1e-14);
      const v = Math.max(0, Math.min(1, (db - DB_FLOOR) / (DB_CEIL - DB_FLOOR)));
      spec[c * BANDS + b] = Math.round(v * 255);
    }
    fullness[c] = full; // total energy in this slice
  }
  // busiest moment: the most energetic few seconds (smoothed over 5 slices),
  // ignoring the very start and end (fade-ins, tails, noise)
  let best = 0, bestAt = 0;
  const edge = Math.max(2, Math.round(COLS * 0.04));
  for (let c = edge; c < COLS - edge; c++) {
    const v = fullness[c - 2] + fullness[c - 1] + fullness[c] + fullness[c + 1] + fullness[c + 2];
    if (v > best) {
      best = v;
      bestAt = c;
    }
  }
  const totalBal = balance.reduce((a, b) => a + b, 0) || 1;

  // loudness per EBU R128
  const r128 = await run('ffmpeg', ['-nostats', '-i', file, '-af', 'ebur128', '-f', 'null', '-'], { capture: 'stderr' });
  const summary = r128.slice(r128.lastIndexOf('Summary:'));
  const lufs = Number(summary.match(/I:\s+(-?[\d.]+) LUFS/)?.[1]);
  const lra = Number(summary.match(/LRA:\s+(-?[\d.]+) LU/)?.[1]);

  return {
    cols: COLS,
    bands: BANDS,
    fLo: F_LO,
    fHi: F_HI,
    spec: Buffer.from(spec).toString('base64'),
    balance: Object.fromEntries(BAL.map(([name], i) => [name, Math.round((balance[i] / totalBal) * 1000) / 1000])),
    brightness: Math.round(centroidNum / (centroidDen || 1)),
    width: Math.round(Math.max(0, Math.min(1, 1 - corr)) * 1000) / 1000,
    peak: Math.round(20 * Math.log10(peak || 1e-9) * 10) / 10,
    lufs: Number.isFinite(lufs) ? lufs : null,
    lra: Number.isFinite(lra) ? lra : null,
    busiest: Math.round(((bestAt + 0.5) / COLS) * (frames / SR)),
  };
}

// every track file with audio; key = "<record>/<track-slug>"
const data = existsSync(OUT) && !FORCE ? JSON.parse(await readFile(OUT, 'utf8')) : {};
const tracksDir = path.join(ROOT, 'src/content/tracks');
const done = new Map(); // audio path → key, to reuse shared recordings
for (const rel of (await readdir(tracksDir)).sort()) {
  for (const f of (await readdir(path.join(tracksDir, rel))).sort()) {
    const md = await readFile(path.join(tracksDir, rel, f), 'utf8');
    const audio = md.match(/^audio:\s*"?([^"\n]+)"?/m)?.[1];
    if (!audio) continue;
    const key = `${rel}/${f.replace(/\.md$/, '').replace(/^\d+-/, '')}`;
    if (data[key]) {
      done.set(audio, key);
      continue;
    }
    if (done.has(audio)) {
      data[key] = data[done.get(audio)];
      console.log(`  ${key}  (same recording as ${done.get(audio)})`);
      continue;
    }
    const t0 = Date.now();
    data[key] = await analyse(path.join(ROOT, 'public', audio));
    done.set(audio, key);
    const a = data[key];
    console.log(`  ${key}  ${a.lufs} LUFS, LRA ${a.lra}, ${a.brightness} Hz, width ${a.width}  (${Date.now() - t0} ms)`);
  }
}
// archive songs with audio; key = "archive/<song>"
const archiveDir = path.join(ROOT, 'src/content/archive');
for (const f of (await readdir(archiveDir)).filter((f) => f.endsWith('.md')).sort()) {
  const md = await readFile(path.join(archiveDir, f), 'utf8');
  const audio = md.match(/^audio:\s*"?([^"\n]+)"?/m)?.[1];
  if (!audio) continue;
  const key = `archive/${f.replace(/\.md$/, '')}`;
  if (data[key]) continue;
  const t0 = Date.now();
  data[key] = await analyse(path.join(ROOT, 'public', audio));
  const a = data[key];
  console.log(`  ${key}  ${a.lufs} LUFS, LRA ${a.lra}, ${a.brightness} Hz, width ${a.width}  (${Date.now() - t0} ms)`);
}

await writeFile(OUT, JSON.stringify(data));
console.log(`wrote ${path.relative(ROOT, OUT)} (${Object.keys(data).length} tracks)`);
