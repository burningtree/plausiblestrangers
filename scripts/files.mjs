#!/usr/bin/env node
// The downloads live apart from the site, on public.plausiblestrangers.com: MP3s of
// every song and the stems (each part, and all of them as one zip). Locally they
// sit in files/ (not in git), laid out exactly as on the server.
//
//   npm run files          # zip the stems, write src/data/files.json
//   npm run files:upload   # copy files/ to the server (rsync: only what changed)
//
// files/ is filled by `npm run mp3` (files/audio/…/*.mp3) and
// `npm run import:stems` (files/stems/<song>/<part>.mp3). This script then makes
// files/stems/<song>.zip and src/data/files.json: { "<path>": size in bytes }
// for everything in files/, so the site knows what exists (and how big) even
// when it is built somewhere without files/, like GitHub.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { zip, joinZip } from '../src/lib/zip.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const FILES = join(ROOT, 'files');
const front = (src) => src.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
const field = (fm, key) => fm.match(new RegExp(`^${key}:\\s*"?(.*?)"?\\s*$`, 'm'))?.[1];

// songs by audio path: their title, and whether they are someone else's (remixes)
const songs = new Map();
for (const kind of ['tracks', 'archive']) {
  const dir = join(ROOT, 'src/content', kind);
  for (const f of readdirSync(dir, { recursive: true }).filter((f) => f.endsWith('.md'))) {
    const fm = front(readFileSync(join(dir, f), 'utf8'));
    const audio = field(fm, 'audio');
    if (audio) songs.set(audio, { title: field(fm, 'title'), remix: field(fm, 'remix') === 'true' });
  }
}

// the stems, all in one zip per song, to remix
const stems = JSON.parse(readFileSync(join(ROOT, 'src/data/stems.json'), 'utf8'));
const cap = (name) => (name.length <= 2 ? name.toUpperCase() : name.replace(/\b\w/g, (c) => c.toUpperCase()));
for (const [audio, { parts }] of Object.entries(stems)) {
  const song = songs.get(audio);
  if (!song || song.remix) continue;
  const base = `Plausible Strangers - ${song.title}`;
  const readme = `${song.title} — Plausible Strangers\n\nThe separate parts of the song, all the same length and starting together:\ndrop them into any audio editor at 0:00 and they line up.\n\n${parts.map((p) => `  ${p.name}`).join('\n')}\n\nLicence: Creative Commons CC0 1.0 Universal (public domain dedication), https://creativecommons.org/publicdomain/zero/1.0/\nNo rights reserved. Remix it, chop it, sing over it — no need to ask.\n`;
  const files = [
    { name: `${base}/README.txt`, data: new TextEncoder().encode(readme) },
    ...parts.map((p) => ({
      name: `${base}/${base} - ${cap(p.name)}${p.src.slice(p.src.lastIndexOf('.'))}`,
      data: new Uint8Array(readFileSync(join(FILES, p.src))),
    })),
  ];
  const out = join(FILES, 'stems', `${audio.split('/').pop().replace(/\.[^.]+$/, '')}.zip`);
  writeFileSync(out, joinZip(zip(files)));
  console.log(`  zip  ${relative(ROOT, out)}`);
}

// what's there, and how big
const sizes = {};
const walk = (dir) => {
  for (const d of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(dir, d.name);
    if (d.isDirectory()) walk(p);
    else if (!d.name.startsWith('.')) sizes['/' + relative(FILES, p)] = statSync(p).size;
  }
};
if (existsSync(FILES)) walk(FILES);
writeFileSync(join(ROOT, 'src/data/files.json'), JSON.stringify(sizes, null, 0).replace(/,"/g, ',\n"') + '\n');
const total = Object.values(sizes).reduce((a, b) => a + b, 0);
console.log(`\n${Object.keys(sizes).length} files (${(total / 1e6).toFixed(0)} MB) in src/data/files.json`);
