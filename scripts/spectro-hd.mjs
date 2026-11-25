#!/usr/bin/env node
// High-resolution spectrograms for track and song pages: 2 time slices per
// second (instead of analysis.json's fixed 240 per song), with the same 40
// log-spaced bands and the same absolute dB scale as scripts/analyse.mjs, so the
// two look alike. Lets the "detail: high" setting show more than 240 columns on
// long songs. The measured stats in analysis.json are not touched.
//
//   npm run spectro              only files not done yet
//   npm run spectro -- --force   everything again
//
// Writes src/data/spectro-hd.json, keyed by the audio file's public path
// (e.g. "/audio/i-am-your-bug/r-u-r.m4a"); only read at build time.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUDIO = path.join(ROOT, 'public/audio');
const OUT = path.join(ROOT, 'src/data/spectro-hd.json');
const FORCE = process.argv.includes('--force');
const PER_SECOND = 2;
// keep in step with scripts/analyse.mjs
const SR = 22050;
const N = 2048;
const BANDS = 40;
const F_LO = 40;
const F_HI = 11000;
const DB_FLOOR = -100;
const DB_CEIL = -20;

const run = (cmd, args) =>
  new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    let err = '';
    p.stdout.on('data', (c) => out.push(c));
    p.stderr.on('data', (c) => (err += c));
    p.on('close', (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(err.slice(-400)))));
  });

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
// which band each FFT bin falls in (-1: outside 40 Hz–11 kHz)
const binBand = Array.from({ length: N / 2 }, (_, k) => {
  const f = k * binHz;
  if (k === 0 || f < F_LO || f >= F_HI) return -1;
  let bi = 0;
  while (bi < BANDS - 1 && f >= bandEdges[bi + 1]) bi++;
  return bi;
});

async function spectro(file) {
  const raw = await run('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-']);
  const mono = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 4));
  const cols = Math.max(1, Math.round((mono.length / SR) * PER_SECOND));
  const spec = new Uint8Array(cols * BANDS);
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const per = 3; // FFT windows averaged per slice
  for (let c = 0; c < cols; c++) {
    const start = Math.floor((c / cols) * (mono.length - N));
    const span = Math.floor(mono.length / cols);
    const bandPow = new Float64Array(BANDS);
    for (let w = 0; w < per; w++) {
      const off = start + Math.floor((w / per) * Math.max(0, span - N));
      for (let i = 0; i < N; i++) {
        re[i] = (mono[off + i] ?? 0) * hann[i];
        im[i] = 0;
      }
      fft(re, im);
      for (let k = 1; k < N / 2; k++) {
        const b = binBand[k];
        if (b >= 0) bandPow[b] += (re[k] * re[k] + im[k] * im[k]) / (N * N) / per;
      }
    }
    for (let b = 0; b < BANDS; b++) {
      const db = 10 * Math.log10(bandPow[b] + 1e-14);
      spec[c * BANDS + b] = Math.round(Math.max(0, Math.min(1, (db - DB_FLOOR) / (DB_CEIL - DB_FLOOR))) * 255);
    }
  }
  return { cols, bands: BANDS, spec: Buffer.from(spec).toString('base64') };
}

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (/\.(m4a|mp3|wav|flac|ogg)$/i.test(e.name)) out.push(p);
  }
  return out;
}

const all = existsSync(OUT) ? JSON.parse(await readFile(OUT, 'utf8')) : {};
let done = 0;
for (const f of await walk(AUDIO)) {
  const key = '/' + path.relative(path.join(ROOT, 'public'), f).split(path.sep).join('/');
  if (all[key] && !FORCE) continue;
  all[key] = await spectro(f);
  done++;
  process.stdout.write(`\r${done} analysed`);
}
await writeFile(OUT, JSON.stringify(all));
console.log(`\n${Object.keys(all).length} files in ${path.relative(ROOT, OUT)}`);
