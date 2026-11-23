#!/usr/bin/env node
// Imports every public Suno song that isn't on a record into the archive.
//
//   npm run import:archive            # add new songs, leave existing files alone
//   npm run import:archive -- --rewrite
//
// Writes src/content/archive/<slug>.md — title, date, length, tempo, tags, the
// prompt (style) and the lyrics. Info only: no audio or images are downloaded;
// each page links to the song on Suno.
//
// A song counts as "released" when a track file in src/content/tracks/ links to
// the same Suno song (its `suno:` field).

import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HANDLE = 'plausiblestrangers';
const REWRITE = process.argv.includes('--rewrite');
const OUT = path.join(ROOT, 'src/content/archive');

// remixes of other people's songs: list them, but don't publish their lyrics
const HIDE_LYRICS = [/plausible strangers remix/i];

// Cyrillic → Latin, so Russian titles get readable URLs too
const CYR = {а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'shch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya'};
const translit = (s) => s.replace(/[а-яё]/gi, (ch) => {
  const l = CYR[ch.toLowerCase()] ?? '';
  return ch === ch.toLowerCase() ? l : l.charAt(0).toUpperCase() + l.slice(1);
});

const slugify = (s) =>
  translit(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'untitled';

const yaml = (obj) =>
  Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? JSON.stringify(v) : v}`)
    .join('\n');

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'plausiblestrangers-site-import' } });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

async function allClips() {
  const clips = new Map();
  for (let page = 1; page < 50; page++) {
    const d = await fetchJson(
      `https://studio-api.prod.suno.com/api/profiles/${HANDLE}?clips_sort_by=created_at&playlists_sort_by=created_at&page=${page}`,
    );
    const batch = d.clips ?? [];
    for (const c of batch) clips.set(c.id, c);
    if (!batch.length || clips.size >= (d.num_total_clips ?? 0)) break;
  }
  return [...clips.values()];
}

async function releasedIds() {
  const ids = new Set();
  const dir = path.join(ROOT, 'src/content/tracks');
  for (const rel of await readdir(dir)) {
    for (const f of await readdir(path.join(dir, rel))) {
      const m = (await readFile(path.join(dir, rel, f), 'utf8')).match(/suno\.com\/song\/([0-9a-f-]+)/);
      if (m) ids.add(m[1]);
    }
  }
  return ids;
}

const clips = await allClips();
const released = await releasedIds();
const unreleased = clips.filter((c) => !released.has(c.id) && c.status === 'complete');
console.log(`${clips.length} public songs on Suno, ${released.size} on records, ${unreleased.length} for the archive`);

await mkdir(OUT, { recursive: true });
const used = new Set();
let written = 0;
for (const c of unreleased.sort((a, b) => a.created_at.localeCompare(b.created_at))) {
  const m = c.metadata ?? {};
  let slug = slugify(c.title);
  while (used.has(slug)) slug += '-b';
  used.add(slug);
  const file = path.join(OUT, `${slug}.md`);
  if (existsSync(file) && !REWRITE) continue;

  const lyrics = (m.prompt ?? '').trim();
  const words = lyrics.replace(/\[[^\]]*\]/g, '').trim();
  const instrumental = Boolean(m.make_instrumental) || words === '';
  const hide = HIDE_LYRICS.some((r) => r.test(c.title)) && !instrumental;
  const style = (m.tags ?? '').trim();
  const bpm = style.match(/(\d{2,3})\s*BPM/i)?.[1];
  const front = yaml({
    title: c.title,
    created: c.created_at?.slice(0, 10),
    duration: m.duration ? Math.round(m.duration * 10) / 10 : undefined,
    bpm: bpm ? Number(bpm) : undefined,
    instrumental,
    lyricsHidden: hide || undefined,
    remix: /remix/i.test(c.title) || undefined,
    tags: c.display_tags,
    machine: c.major_model_version ? `suno ${c.major_model_version}` : undefined,
    suno: `https://suno.com/song/${c.id}`,
  });
  const styleYaml = style ? `\nstyle: |-\n${style.split('\n').map((l) => `  ${l}`).join('\n')}` : '';
  // keep words (and multi-line scores of instrumentals); drop lyrics we shouldn't publish
  const body = hide ? '' : !instrumental || lyrics.includes('\n') ? `${lyrics}\n` : '';
  await writeFile(file, `---\n${front}${styleYaml}\n---\n${body}`);
  written++;
  console.log(`  ${slug}`);
}
console.log(`done: ${written} written.`);
