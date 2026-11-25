#!/usr/bin/env node
// Downloads of every song, next to the m4a the player streams: an MP3 (320 kbps)
// of each, and a FLAC of each that has a lossless master (WAV). Tagged (title,
// artist, album, track number, year) and, for records, with the cover.
//
//   npm run downloads -- "/path/to/My Music/Plausible Strangers"          # make the missing ones
//   npm run downloads -- "/path/to/My Music/Plausible Strangers" --dry    # only show the sources
//   npm run downloads -- "/path/to/My Music/Plausible Strangers" --force  # make them all again
//
// Each MP3 is made from the best source there is: a WAV master if one matches
// (by name and by length), else the original download (m4a/mp3/flac), and only
// when nothing matches, the site's own m4a (lossy to lossy: the script says so).
// They go to files/audio/<…>/<song>.mp3 and .flac (the m4a's path, on the download
// server); afterwards run `npm run files` and `npm run files:upload`.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, renameSync } from 'node:fs';
import { join, extname, basename, dirname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const FORCE = args.includes('--force');
const SRC = args.find((a) => !a.startsWith('--'));
if (!SRC) {
  console.error('usage: npm run downloads -- "/path/to/music folder" [--dry] [--force]');
  process.exit(1);
}
const TOLERANCE = 1.5; // seconds
const RANK = { '.wav': 0, '.flac': 0, '.aiff': 0, '.m4a': 1, '.mp3': 2 };

const norm = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const front = (src) => src.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
const field = (fm, key) => fm.match(new RegExp(`^${key}:\\s*"?(.*?)"?\\s*$`, 'm'))?.[1];
const length = (file) =>
  Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim());

// the songs: tracks of records, and the library (archive)
const releases = Object.fromEntries(
  readdirSync(join(ROOT, 'src/content/releases'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const fm = front(readFileSync(join(ROOT, 'src/content/releases', f), 'utf8'));
      return [f.replace(/\.md$/, ''), { title: field(fm, 'title'), date: field(fm, 'date'), cover: field(fm, 'cover') }];
    }),
);
const songs = [];
for (const kind of ['tracks', 'archive']) {
  const dir = join(ROOT, 'src/content', kind);
  for (const f of readdirSync(dir, { recursive: true }).filter((f) => f.endsWith('.md'))) {
    const fm = front(readFileSync(join(dir, f), 'utf8'));
    const audio = field(fm, 'audio');
    if (!audio || !existsSync(join(ROOT, 'public', audio))) continue;
    const release = field(fm, 'release');
    songs.push({
      title: field(fm, 'title'),
      audio,
      duration: Number(field(fm, 'duration')),
      release,
      number: Number(field(fm, 'number')) || undefined,
      created: field(fm, 'created'),
    });
  }
}

// the source files: everything audio in the folder, except stems and kept originals
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name);
    if (d.isDirectory()) return / - stems$/i.test(d.name) ? [] : walk(p);
    return RANK[extname(d.name).toLowerCase()] !== undefined && !/_original\.\w+$/i.test(d.name) ? [p] : [];
  });
}
const sources = walk(SRC).map((file) => ({
  file,
  name: norm(basename(file, extname(file)).replace(/^\d+[-_ .]+/, '')),
  folder: norm(basename(dirname(file)).replace(/^\d+[-_ ]+/, '').replace(/[-_ ]ep$/i, '')),
  number: Number(basename(file).match(/^(\d+)[-_ .]/)?.[1]) || undefined,
  rank: RANK[extname(file).toLowerCase()],
  length: undefined,
}));
const lengthOf = (s) => (s.length ??= length(s.file));

function sourceFor(song) {
  const title = norm(song.title);
  const album = song.release ? norm(releases[song.release]?.title ?? song.release) : undefined;
  const fits = sources
    .filter((s) => {
      const named = s.name === title || s.name.replace(/ /g, '') === title.replace(/ /g, '');
      const placed = album && s.folder === album && s.number === song.number;
      return named || placed;
    })
    .filter((s) => Math.abs(lengthOf(s) - song.duration) <= TOLERANCE);
  fits.sort((a, b) => a.rank - b.rank);
  return fits[0];
}

let made = 0;
let fallback = 0;
for (const song of songs) {
  const base = join(ROOT, 'files', song.audio.replace(/\.[^.]+$/, ''));
  const want = { mp3: !existsSync(`${base}.mp3`) || FORCE, flac: !existsSync(`${base}.flac`) || FORCE };
  if (!want.mp3 && !want.flac && existsSync(`${base}.mp3`)) continue;
  const src = sourceFor(song);
  const lossless = src && src.rank === 0;
  if (!want.mp3 && !(want.flac && lossless)) continue;
  const from = src?.file ?? join(ROOT, 'public', song.audio);
  if (!src) fallback++;
  const label = src ? `${extname(src.file).slice(1)}  ${src.file.slice(SRC.length).replace(/^\//, '')}` : 'site m4a (no source found — lossy to lossy)';
  console.log(`  ${src ? '✓' : '~'}  ${song.title.padEnd(44)} ← ${label}${lossless ? '  (+ flac)' : ''}`);
  if (DRY) continue;

  const rel = song.release && releases[song.release];
  const cover = rel?.cover && join(ROOT, 'public', rel.cover.replace(/\.webp$/, '.jpg'));
  const year = (rel?.date ?? song.created ?? '').slice(0, 4);
  const tags = [
    ['title', song.title],
    ['artist', 'Plausible Strangers'],
    ['album_artist', 'Plausible Strangers'],
    ...(rel ? [['album', rel.title], ['track', String(song.number)]] : []),
    ...(year ? [['date', year]] : []),
    ['copyright', 'CC0 1.0 — no rights reserved'],
  ];
  const withCover = cover && existsSync(cover);
  const picture = withCover
    ? ['-i', cover, '-map', '0:a', '-map', '1:v', '-c:v', 'copy', '-disposition:v', 'attached_pic', '-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover (front)']
    : ['-map', '0:a'];
  mkdirSync(dirname(base), { recursive: true });
  const encode = (ext, codec) => {
    const tmp = `${base}.tmp.${ext}`;
    execFileSync('ffmpeg', [
      '-v', 'error', '-y', '-i', from, ...picture, '-map_metadata', '-1', ...codec,
      ...tags.flatMap(([k, v]) => ['-metadata', `${k}=${v}`]),
      tmp,
    ]);
    renameSync(tmp, `${base}.${ext}`);
    made++;
  };
  if (want.mp3) encode('mp3', ['-c:a', 'libmp3lame', '-b:a', '320k', '-id3v2_version', '3']);
  // lossless only from a lossless master: a FLAC of an m4a would just be a bigger m4a
  if (want.flac && lossless) encode('flac', ['-c:a', 'flac', '-compression_level', '8']);
}
console.log(`\n${DRY ? 'would make files for' : 'made'} ${DRY ? songs.length + ' songs' : made + ' files'}${fallback ? `, ${fallback} mp3s from the site's m4a` : ''}`);
