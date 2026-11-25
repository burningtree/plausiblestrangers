#!/usr/bin/env node
// The beat grid of every recording: where the beats fall, and how much the sound
// changes around each one. Song sections taken from the lyrics are
// snapped to it (src/lib/catalog.ts → songSections), since a verse or chorus
// usually turns over on the beat, often a bar or two before the voice comes in.
//
//   npm run grid            # recordings not done yet
//   npm run grid -- --force # all of them
//
// Writes src/data/grid.json: { "<audio path>": { bpm, first, beat, change: [...] } }
//   first  — the first beat (s), beat — one beat (s),
//   change — per beat, |loudness of the bar after − the bar before| (log energy)
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { onsets } from './lib/tempo.mjs';

const root = new URL('..', import.meta.url).pathname;
const OUT = join(root, 'src/data/grid.json');
const FORCE = process.argv.includes('--force');

function songs(dir) {
  return readdirSync(dir, { recursive: true })
    .filter((f) => f.endsWith('.md'))
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .map((src) => ({
      audio: src.match(/^audio:\s*"?(.*?)"?\s*$/m)?.[1],
      bpm: Number(src.match(/^bpm:\s*([\d.]+)/m)?.[1]) || undefined,
    }))
    .filter((s) => s.audio && existsSync(join(root, 'public', s.audio)));
}

async function grid(file, hint) {
  const { o, fps, x, sr, offset } = await onsets(file);
  const sum = (lag, phase) => {
    let s = 0;
    for (let t = phase; t < o.length - 1; t += lag) {
      const i = Math.floor(t);
      s += o[i] * (1 - (t - i)) + o[i + 1] * (t - i);
    }
    return s;
  };
  // tempo: the prompt's bpm (or a rough read) refined to the beat, then the beat's phase
  let best = { s: -1, bpm: hint, phase: 0 };
  for (let bpm = hint * 0.94; bpm <= hint * 1.06; bpm += 0.02) {
    const lag = (60 / bpm) * fps;
    for (let phase = 0; phase < lag; phase += 0.5) {
      const s = sum(lag, phase);
      if (s > best.s) best = { s, bpm, phase };
    }
  }
  const beat = 60 / best.bpm;
  const bar = 4 * beat;

  // loudness per 10 ms
  const hop = Math.round(sr / 100);
  const e = new Float32Array(Math.floor(x.length / hop));
  for (let i = 0; i < e.length; i++) {
    let s = 0;
    for (let j = 0; j < hop; j++) s += x[i * hop + j] ** 2;
    e[i] = Math.log(1e-6 + s);
  }
  const level = (from, to) => {
    const a = Math.max(0, Math.round(from * 100));
    const b = Math.min(e.length, Math.round(to * 100));
    let s = 0;
    for (let i = a; i < b; i++) s += e[i];
    return b > a ? s / (b - a) : -14;
  };
  const duration = x.length / sr;
  // per beat: how much louder or quieter the bar after it is than the bar before
  const first = (best.phase / fps + offset) % beat;
  const change = [];
  for (let t = first; t < duration; t += beat) change.push(t < bar ? 0 : +Math.abs(level(t, t + bar) - level(t - bar, t)).toFixed(2));
  return { bpm: +best.bpm.toFixed(2), first: +first.toFixed(3), beat: +beat.toFixed(4), change };
}

const data = existsSync(OUT) && !FORCE ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const all = [...songs(join(root, 'src/content/archive')), ...songs(join(root, 'src/content/tracks'))];
const todo = [...new Map(all.map((s) => [s.audio, s])).values()].filter((s) => !data[s.audio]);
let n = 0;
for (const s of todo) {
  const file = join(root, 'public', s.audio);
  data[s.audio] = await grid(file, s.bpm ?? 125);
  process.stdout.write(`\r${++n}/${todo.length} gridded`);
}
writeFileSync(OUT, JSON.stringify(data, null, 0).replace(/\},"/g, '},\n"') + '\n');
console.log(`\n${Object.keys(data).length} recordings in src/data/grid.json`);
