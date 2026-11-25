// Stems (the separate parts of a song), from folders named "<Title> - stems"
// holding "<Title> - <Part>.mp3" files, matched to songs by title.
//
//   npm run import:stems -- "<folder that holds the stem folders>"
//
// Copies each part to files/stems/<slug>/<part>.mp3 (as it is, no re-encoding),
// measures its loudness (4 values a second, like peaks-hd) and writes
// src/data/stems.json, keyed by the song's audio path. Then `npm run files` zips
// them and `npm run files:upload` puts them on public.plausiblestrangers.com.
import { readFileSync, writeFileSync, readdirSync, copyFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { execFileSync } from 'node:child_process';

const folder = process.argv[2];
if (!folder) {
  console.error('usage: npm run import:stems -- <folder>');
  process.exit(1);
}
const root = new URL('..', import.meta.url).pathname;
const dataFile = join(root, 'src/data/stems.json');

const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const slug = (s) => norm(s).replace(/ /g, '-');

function songs(dir) {
  return readdirSync(dir, { recursive: true })
    .filter((f) => f.endsWith('.md'))
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .map((src) => ({ title: src.match(/^title:\s*"?(.*?)"?\s*$/m)?.[1], audio: src.match(/^audio:\s*"?(.*?)"?\s*$/m)?.[1] }))
    .filter((s) => s.title && s.audio);
}
const library = [...songs(join(root, 'src/content/archive')), ...songs(join(root, 'src/content/tracks'))];

// the order the lanes are listed in: voices, then the music, then the beat
const ORDER = ['vocals', 'backing vocals', 'synth', 'strings', 'guitar', 'keys', 'piano', 'other', 'fx', 'bass', 'drums'];
const rank = (name) => (ORDER.indexOf(name) < 0 ? ORDER.length : ORDER.indexOf(name));

function peaks(file) {
  const RATE = 4000, PER_SECOND = 4;
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-'], { maxBuffer: 1 << 28 });
  const x = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));
  const size = RATE / PER_SECOND;
  const rms = [];
  for (let i = 0; i + size <= x.length; i += size) {
    let s = 0;
    for (let j = i; j < i + size; j++) s += x[j] * x[j];
    rms.push(Math.sqrt(s / size));
  }
  return rms;
}

const data = existsSync(dataFile) ? JSON.parse(readFileSync(dataFile, 'utf8')) : {};
let added = 0;
for (const dir of readdirSync(folder, { withFileTypes: true }).filter((d) => d.isDirectory() && / - stems$/i.test(d.name))) {
  const title = dir.name.replace(/ - stems$/i, '');
  const song = library.find((s) => norm(s.title) === norm(title));
  if (!song) {
    console.log(`  ?  ${dir.name}: no song with audio by that name`);
    continue;
  }
  const id = slug(title);
  const out = join(root, 'files/stems', id);
  mkdirSync(out, { recursive: true });
  const parts = [];
  for (const file of readdirSync(join(folder, dir.name)).filter((f) => /\.(mp3|m4a|wav)$/i.test(f))) {
    const name = file.slice(0, -extname(file).length).split(' - ').pop().toLowerCase();
    const target = join(out, `${slug(name)}${extname(file).toLowerCase()}`);
    copyFileSync(join(folder, dir.name, file), target);
    parts.push({ name, src: `/stems/${id}/${slug(name)}${extname(file).toLowerCase()}`, size: statSync(target).size, rms: peaks(target) });
  }
  // one scale for all the parts, so a quiet part looks quiet next to a loud one
  const top = Math.max(...parts.flatMap((p) => p.rms)) || 1;
  data[song.audio] = {
    parts: parts
      .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name))
      .map(({ rms, ...p }) => ({ ...p, peaks: rms.map((v) => Math.round((v / top) * 100) / 100) })),
  };
  console.log(`  ✓  ${title} → ${song.audio}: ${parts.map((p) => p.name).join(', ')}`);
  added++;
}
writeFileSync(dataFile, JSON.stringify(data) + '\n');
console.log(`\n${added} songs with stems in src/data/stems.json`);
