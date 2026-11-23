#!/usr/bin/env node
// Imports records from a local music folder (+ public Suno data) into the site.
//
//   npm run import -- "/path/to/My Music/Plausible Strangers"
//
// Folder layout:  NNN-RECORD-NAME[-EP]/NN-track.wav + cover-upscaled.(jpg|png)
//
// What it does, per record:
//   - public/covers/<slug>.webp (+ -480.webp thumb, .jpg for social previews)
//   - public/audio/<slug>/<nn>-<track>.m4a       (AAC ~128 kbps, from the WAVs)
//   - src/data/peaks.json                        (waveform data for the player)
//   - src/content/releases/<slug>.md             (only if missing — yours to edit)
//   - src/content/tracks/<slug>/<nn>-<track>.md  (only if missing — lyrics live here)
//
// Re-running is safe: existing audio/covers/markdown are left alone.
// Pass --force to re-encode audio and covers, --rewrite to regenerate markdown.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SUNO_HANDLE = 'plausiblestrangers';
const PEAK_COUNT = 160;
// Apple's AAC encoder on macOS is the best there is; ffmpeg's own is the fallback elsewhere.
let AAC = 'aac';

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const REWRITE = args.includes('--rewrite');
const SRC = args.find((a) => !a.startsWith('--')) ?? process.env.MUSIC_DIR;
if (!SRC) {
  console.error('usage: npm run import -- "/path/to/Plausible Strangers" [--force] [--rewrite]');
  process.exit(1);
}

const slugify = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const norm = (s) => slugify(s).replace(/-ep$/, '');

const titleFromFile = (s) =>
  s
    .replace(/\.[^.]+$/, '')
    .replace(/^\d+[-_ ]+/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

function run(cmd, argv, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, argv, { stdio: ['ignore', capture ? 'pipe' : 'ignore', 'pipe'] });
    const chunks = [];
    let err = '';
    if (capture) p.stdout.on('data', (c) => chunks.push(c));
    p.stderr.on('data', (c) => (err += c));
    p.on('close', (code) =>
      code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`${cmd} failed: ${err.slice(-500)}`)),
    );
  });
}

async function probe(file) {
  const out = await run(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration:format_tags', '-of', 'json', file],
    { capture: true },
  );
  const { format } = JSON.parse(out.toString());
  return {
    duration: Math.round(Number(format.duration) * 10) / 10,
    bpm: format.tags?.TBPM ? Number(format.tags.TBPM) : undefined,
    key: format.tags?.TKEY || undefined,
  };
}

async function peaks(file) {
  const pcm = await run(
    'ffmpeg',
    ['-v', 'error', '-i', file, '-ac', '1', '-ar', '4000', '-f', 's16le', '-'],
    { capture: true },
  );
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

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'plausiblestrangers-site-import' } });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

async function loadSuno() {
  try {
    const profile = await fetchJson(
      `https://studio-api.prod.suno.com/api/profiles/${SUNO_HANDLE}?playlists_sort_by=created_at&clips_sort_by=created_at&page=1`,
    );
    const playlists = [];
    for (const p of profile.playlists ?? []) {
      const full = await fetchJson(`https://studio-api.prod.suno.com/api/playlist/${p.id}?page=1`);
      playlists.push({
        id: p.id,
        name: full.name,
        clips: (full.playlist_clips ?? [])
          .sort((a, b) => a.relative_index - b.relative_index)
          .map(({ clip }) => clip),
      });
    }
    return playlists;
  } catch (e) {
    console.warn(`! could not reach Suno (${e.message}) — continuing with file names only`);
    return [];
  }
}

const yaml = (obj) =>
  Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? JSON.stringify(v) : v}`)
    .join('\n');

async function writeIfAllowed(file, content) {
  if (existsSync(file) && !REWRITE) return false;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
  return true;
}

// ---------------------------------------------------------------------------

try {
  const enc = (await run('ffmpeg', ['-hide_banner', '-encoders'], { capture: true })).toString();
  if (/\baac_at\b/.test(enc)) AAC = 'aac_at';
} catch {}

const suno = await loadSuno();
const peaksFile = path.join(ROOT, 'src/data/peaks.json');
const allPeaks = existsSync(peaksFile) ? JSON.parse(await readFile(peaksFile, 'utf8')) : {};

const folders = (await readdir(SRC, { withFileTypes: true }))
  .filter((d) => d.isDirectory() && /^\d+[-_ ]/.test(d.name))
  .map((d) => d.name)
  .sort();

for (const folder of folders) {
  const dir = path.join(SRC, folder);
  const [, num, rest] = folder.match(/^(\d+)[-_ ]+(.*)$/);
  const isEP = /[-_ ]EP$/i.test(rest);
  const playlist = suno.find((p) => norm(p.name) === norm(rest));
  const title = playlist ? playlist.name.replace(/\s+EP$/i, '') : titleFromFile(rest.replace(/[-_ ]EP$/i, ''));
  const slug = slugify(title);
  const files = (await readdir(dir)).sort();
  const wavs = files.filter((f) => /\.(wav|aiff?|flac)$/i.test(f));
  const cover =
    files.find((f) => /^cover[-_]upscaled\./i.test(f)) ?? files.find((f) => /^cover/i.test(f));

  console.log(`\n${folder} → ${slug}${playlist ? '' : '  (no Suno match)'}`);

  // cover
  if (cover) {
    const outDir = path.join(ROOT, 'public/covers');
    await mkdir(outDir, { recursive: true });
    const src = path.join(dir, cover);
    const jobs = [
      [`${slug}.webp`, ['-resize', '1400x1400', '-quality', '82']],
      [`${slug}-480.webp`, ['-resize', '480x480', '-quality', '78']],
      [`${slug}.jpg`, ['-resize', '1200x1200', '-quality', '84']],
    ];
    for (const [name, opts] of jobs) {
      const out = path.join(outDir, name);
      if (existsSync(out) && !FORCE) continue;
      await run('magick', [src, '-strip', ...opts, out]);
      console.log(`  cover  ${name}`);
    }
  }

  const clips = playlist?.clips ?? [];
  let latest = '';
  const trackSlugs = [];

  for (const [i, wav] of wavs.entries()) {
    const n = i + 1;
    const nn = String(n).padStart(2, '0');
    const clip = clips[i];
    const tTitle = clip?.title ?? titleFromFile(wav);
    const tSlug = slugify(tTitle);
    trackSlugs.push(tSlug);
    const src = path.join(dir, wav);
    const audioRel = `audio/${slug}/${nn}-${tSlug}.m4a`;
    const audioOut = path.join(ROOT, 'public', audioRel);

    const info = await probe(src);
    if (!existsSync(audioOut) || FORCE) {
      await mkdir(path.dirname(audioOut), { recursive: true });
      await run('ffmpeg', [
        '-v', 'error', '-y', '-i', src, '-map_metadata', '-1',
        '-vn', '-codec:a', AAC, '-b:a', '128k',
        ...(AAC === 'aac_at' ? ['-aac_at_mode', 'cvbr'] : []),
        '-movflags', '+faststart',
        '-metadata', `title=${tTitle}`, '-metadata', 'artist=Plausible Strangers',
        '-metadata', `album=${title}`, '-metadata', `track=${n}/${wavs.length}`,
        audioOut,
      ]);
      console.log(`  audio  ${audioRel}`);
    }
    const key = `${slug}/${tSlug}`;
    if (!allPeaks[key] || FORCE) allPeaks[key] = await peaks(src);

    const m = clip?.metadata ?? {};
    const lyrics = (m.prompt ?? '').trim();
    const instrumental = Boolean(m.make_instrumental) || lyrics.replace(/\[[^\]]*\]/g, '').trim() === '';
    const created = clip?.created_at?.slice(0, 10);
    if (created && created > latest) latest = created;

    const front = yaml({
      title: tTitle,
      release: slug,
      number: n,
      audio: `/${audioRel}`,
      duration: info.duration,
      bpm: info.bpm,
      key: info.key,
      instrumental,
      created,
      machine: clip?.major_model_version ? `suno ${clip.major_model_version}` : undefined,
      tags: clip?.display_tags,
      suno: clip ? `https://suno.com/song/${clip.id}` : undefined,
    });
    const style = (m.tags ?? '').trim();
    const styleYaml = style ? `\nstyle: |-\n${style.split('\n').map((l) => `  ${l}`).join('\n')}` : '';
    // instrumentals keep their directions too (shown as 'the score') unless it's a one-liner
    const body = !instrumental || lyrics.includes('\n') ? `${lyrics}\n` : '';
    const wrote = await writeIfAllowed(
      path.join(ROOT, `src/content/tracks/${slug}/${nn}-${tSlug}.md`),
      `---\n${front}${styleYaml}\n---\n${body}`,
    );
    if (wrote) console.log(`  track  ${nn} ${tTitle}`);
  }

  const relFront = yaml({
    title,
    kind: isEP ? 'EP' : 'album',
    catalog: `ps${num}`,
    date: latest || undefined,
    cover: cover ? `/covers/${slug}.webp` : undefined,
    suno: playlist ? `https://suno.com/playlist/${playlist.id}` : undefined,
  });
  const wrote = await writeIfAllowed(
    path.join(ROOT, `src/content/releases/${slug}.md`),
    `---\n${relFront}\n---\n`,
  );
  if (wrote) console.log(`  release ${title}`);
}

await mkdir(path.dirname(peaksFile), { recursive: true });
await writeFile(peaksFile, JSON.stringify(allPeaks));
console.log('\ndone.');
