#!/usr/bin/env node
// Adds audio to songs that don't have any yet, from a folder of loose files
// (e.g. downloads from Suno): archive songs and tracks of unfinished records.
//
//   npm run import:audio -- "/path/to/Unreleased"          # import
//   npm run import:audio -- "/path/to/Unreleased" --dry    # only show the matches
//
// Each file (m4a, mp3, wav, flac) is matched to a song by name — the file name
// against the song's slug or title — and checked by length (within 1.5 s).
// When two songs fit equally well, a track on a record wins over the archive,
// and the script says so.
//
// Per match:
//   - public/audio/archive/<song>.m4a or public/audio/<record>/<nn>-<track>.m4a
//     (AAC ~128 kbps, like the records)
//   - an `audio:` line in the song's markdown
//   - its waveform in src/data/peaks.json
//   - a `bpm:` line if it had none (from the prompt, else measured from the audio)
// Afterwards run `npm run analyse` for the spectrograms and numbers.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempo } from './lib/tempo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const SRC = args.find((a) => !a.startsWith('--'));
if (!SRC) {
  console.error('usage: npm run import:audio -- "/path/to/folder" [--dry]');
  process.exit(1);
}
const PEAK_COUNT = 160;
const TOLERANCE = 1.5; // seconds

const norm = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

function run(cmd, argv, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, argv, { stdio: ['ignore', capture ? 'pipe' : 'ignore', 'pipe'] });
    const chunks = [];
    let err = '';
    if (capture) p.stdout.on('data', (c) => chunks.push(c));
    p.stderr.on('data', (c) => (err += c));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`${cmd}: ${err.trim()}`))));
  });
}

const durationOf = async (file) =>
  Number(
    (await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { capture: true }))
      .toString()
      .trim(),
  );

async function peaks(file) {
  const pcm = await run('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', '4000', '-f', 's16le', '-'], {
    capture: true,
  });
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));
  const size = Math.floor(samples.length / PEAK_COUNT);
  const rms = [];
  for (let i = 0; i < PEAK_COUNT; i++) {
    let sum = 0;
    for (let j = i * size; j < (i + 1) * size; j++) sum += samples[j] * samples[j];
    rms.push(Math.sqrt(sum / size));
  }
  const max = Math.max(...rms) || 1;
  return rms.map((v) => Math.round((v / max) * 100) / 100);
}

// ---- every song that could take audio
const front = (md, k) => md.match(new RegExp(`^${k}:\\s*"?([^"\\n]*)"?`, 'm'))?.[1];
const songs = [];
const archiveDir = path.join(ROOT, 'src/content/archive');
for (const f of (await readdir(archiveDir)).filter((f) => f.endsWith('.md'))) {
  const md = await readFile(path.join(archiveDir, f), 'utf8');
  const id = f.replace(/\.md$/, '');
  songs.push({
    kind: 'archive',
    md: path.join(archiveDir, f),
    names: [id, front(md, 'title') ?? ''],
    title: front(md, 'title'),
    duration: Number(front(md, 'duration')) || undefined,
    audio: front(md, 'audio'),
    out: `/audio/archive/${id}.m4a`,
    peaksKey: `archive/${id}`,
  });
}
const tracksDir = path.join(ROOT, 'src/content/tracks');
for (const rec of await readdir(tracksDir)) {
  for (const f of (await readdir(path.join(tracksDir, rec))).filter((f) => f.endsWith('.md'))) {
    const md = await readFile(path.join(tracksDir, rec, f), 'utf8');
    const base = f.replace(/\.md$/, '');
    songs.push({
      kind: 'track',
      md: path.join(tracksDir, rec, f),
      names: [base.replace(/^\d+-/, ''), front(md, 'title') ?? ''],
      title: front(md, 'title'),
      duration: Number(front(md, 'duration')) || undefined,
      audio: front(md, 'audio'),
      out: `/audio/${rec}/${base}.m4a`,
      peaksKey: `${rec}/${base.replace(/^\d+-/, '')}`,
    });
  }
}
// titles like "🧬 08 — MUTANT FREQUENCY 1 - …": compare without the emoji and number
const clean = (s) => norm(s.replace(/^[^\p{L}\p{N}]+/u, '').replace(/^\d+\s*[—–-]\s*/, ''));

let AAC = 'aac';
try {
  if (/\baac_at\b/.test((await run('ffmpeg', ['-hide_banner', '-encoders'], { capture: true })).toString())) AAC = 'aac_at';
} catch {}

const peaksFile = path.join(ROOT, 'src/data/peaks.json');
const allPeaks = existsSync(peaksFile) ? JSON.parse(await readFile(peaksFile, 'utf8')) : {};
const files = (await readdir(SRC)).filter((f) => /\.(m4a|mp3|wav|flac|aiff?)$/i.test(f)).sort();
const taken = new Set();
let added = 0;

for (const file of files) {
  const src = path.join(SRC, file);
  const key = clean(file.replace(/\.[^.]+$/, '').replace(/^\d+[-_ ]+(?=\D)/, ''));
  const keyRaw = clean(file.replace(/\.[^.]+$/, ''));
  const length = await durationOf(src);
  const named = songs.filter((s) => s.names.some((n) => [key, keyRaw].includes(clean(n))));
  if (!named.length) {
    console.log(`  ?  ${file}: no song by that name`);
    continue;
  }
  // a file that's already on one of these songs (same length) was imported before:
  // don't hand it to a second song with the same name
  const imported = named.find((s) => s.audio && s.duration && Math.abs(s.duration - length) <= TOLERANCE);
  if (imported) {
    console.log(`  –  ${file}: already imported (${imported.audio})`);
    continue;
  }
  const open = named.filter((s) => !s.audio && !taken.has(s));
  if (!open.length) {
    console.log(`  –  ${file}: already has audio (${named.map((s) => s.audio).join(', ')})`);
    continue;
  }
  const fits = open
    .map((s) => ({ s, off: s.duration ? Math.abs(s.duration - length) : 0 }))
    .filter((c) => c.off <= TOLERANCE)
    // lengths within half a second are a tie (exported files are often cut to
    // 0.4 s steps): then the record's track wins over the archive
    .sort((a, b) =>
      Math.abs(a.off - b.off) < 0.5 && a.s.kind !== b.s.kind ? (a.s.kind === 'track' ? -1 : 1) : a.off - b.off,
    );
  if (!fits.length) {
    console.log(`  ≠  ${file}: ${length.toFixed(1)} s, but ${open.map((s) => `${s.title} is ${s.duration} s`).join('; ')}`);
    continue;
  }
  const { s } = fits[0];
  const alsoFits = fits.slice(1).filter((c) => c.off - fits[0].off < 0.5);
  console.log(
    `  ✓  ${file} → ${s.kind === 'archive' ? 'archive' : 'track'} “${s.title}” (${length.toFixed(1)} s vs ${s.duration} s)` +
      (alsoFits.length ? `\n       also fits: ${alsoFits.map((c) => c.s.md.replace(ROOT + '/', '')).join(', ')} — check this one` : ''),
  );
  taken.add(s);
  if (DRY) continue;

  const out = path.join(ROOT, 'public', s.out);
  await mkdir(path.dirname(out), { recursive: true });
  await run('ffmpeg', [
    '-v', 'error', '-y', '-i', src, '-map_metadata', '-1',
    '-vn', '-codec:a', AAC, '-b:a', '128k',
    ...(AAC === 'aac_at' ? ['-aac_at_mode', 'cvbr'] : []),
    '-movflags', '+faststart',
    '-metadata', `title=${s.title}`, '-metadata', 'artist=Plausible Strangers',
    out,
  ]);
  allPeaks[s.peaksKey] = await peaks(out);
  // the audio line goes after `duration:` (or at the end of the front matter)
  const md = await readFile(s.md, 'utf8');
  // no tempo yet? measure it from the audio (the prompt's "NNN BPM" wins if there is one)
  const bpm = /^bpm:/m.test(md) ? undefined : (Number(md.match(/(\d{2,3})\s*BPM/i)?.[1]) || (await tempo(out)));
  const line = `audio: "${s.out}"${bpm ? `\nbpm: ${bpm}` : ''}`;
  const next = /^duration:.*$/m.test(md)
    ? md.replace(/^(duration:.*)$/m, `$1\n${line}`)
    : md.replace(/^---\n([\s\S]*?)\n---/, `---\n$1\n${line}\n---`);
  await writeFile(s.md, next);
  added++;
}

if (!DRY && added) await writeFile(peaksFile, JSON.stringify(allPeaks));
console.log(`\n${DRY ? 'would add' : 'added'} audio to ${DRY ? taken.size : added} songs.${!DRY && added ? ' Now run: npm run analyse' : ''}`);
