// Sheet music exported from the machine (MusicXML, MIDI), matched to songs by title.
//
//   npm run import:scores -- "<folder with Title.musicxml / Title.mid>"
//
// Copies the files to public/score/<slug>.{musicxml,mid} and writes a summary
// (key, metre, bars, parts, sections, bar start times) to src/data/scores.json,
// keyed by the song's audio path like the other data files.
import { readFileSync, writeFileSync, readdirSync, copyFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { execFileSync } from 'node:child_process';

const folder = process.argv[2];
if (!folder) {
  console.error('usage: npm run import:scores -- <folder>');
  process.exit(1);
}

const root = new URL('..', import.meta.url).pathname;
const out = join(root, 'public/score');
const dataFile = join(root, 'src/data/scores.json');
mkdirSync(out, { recursive: true });

const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const slug = (s) => norm(s).replace(/ /g, '-');

// every song with audio, from archive and records
function songs(dir) {
  return readdirSync(dir, { recursive: true })
    .filter((f) => f.endsWith('.md'))
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .map((src) => ({
      title: src.match(/^title:\s*"?(.*?)"?\s*$/m)?.[1],
      audio: src.match(/^audio:\s*"?(.*?)"?\s*$/m)?.[1],
      duration: Number(src.match(/^duration:\s*([\d.]+)/m)?.[1]) || undefined,
    }))
    .filter((s) => s.title && s.audio);
}
const library = [...songs(join(root, 'src/content/archive')), ...songs(join(root, 'src/content/tracks'))];

const FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
const SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const MAJOR = ['C♭', 'G♭', 'D♭', 'A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯'];
const MINOR = ['A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯', 'G♯', 'D♯', 'A♯'];
const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const KIND = { major: '', minor: 'm', dominant: '7', 'major-seventh': 'maj7', 'minor-seventh': 'm7', diminished: '°', augmented: '+', 'suspended-fourth': 'sus4', 'suspended-second': 'sus2', 'half-diminished': 'ø', power: '5' };

function summarise(xml) {
  const fifths = Number(xml.match(/<fifths>(-?\d+)<\/fifths>/)?.[1] ?? 0);
  const mode = xml.match(/<mode>(\w+)<\/mode>/)?.[1] ?? 'major';
  const names = fifths < 0 ? FLAT_NAMES : SHARP_NAMES;
  const noteName = (midi) => names[midi % 12] + (Math.floor(midi / 12) - 1);
  const partNames = [...xml.matchAll(/<score-part id="([^"]+)">[\s\S]*?<part-name>([^<]*)</g)].map((m) => [m[1], m[2]]);

  const parts = [];
  let bars = [];
  let sections = [];
  const tempos = new Set();
  const meters = new Set();
  const chords = new Map();
  const onsets = [];

  for (const [, id, body] of xml.matchAll(/<part id="([^"]+)">([\s\S]*?)<\/part>/g)) {
    const measures = [...body.matchAll(/<measure number="(\d+)"[^>]*>([\s\S]*?)<\/measure>/g)];
    let notes = 0, low = Infinity, high = -Infinity;
    let tempo = 120, beats = 4, beatType = 4, t = 0, divisions = 1;
    const starts = [];
    const marks = [];
    for (const [, number, m] of measures) {
      const time = m.match(/<beats>(\d+)<\/beats>\s*<beat-type>(\d+)/);
      if (time) { beats = +time[1]; beatType = +time[2]; meters.add(`${beats}/${beatType}`); }
      const tm = m.match(/<sound[^>]*tempo="([\d.]+)"/);
      if (tm) { tempo = +tm[1]; tempos.add(tempo); }
      starts.push(+t.toFixed(3));
      for (const r of m.matchAll(/<rehearsal>([^<]*)</g)) marks.push({ name: r[1], bar: +number, at: +t.toFixed(2) });
      for (const h of m.matchAll(/<harmony>([\s\S]*?)<\/harmony>/g)) {
        const root = h[1].match(/<root-step>(\w)<\/root-step>(?:\s*<root-alter>(-?\d)<\/root-alter>)?/);
        if (!root) continue;
        const pc = (STEP[root[1]] + Number(root[2] ?? 0) + 12) % 12;
        const kind = h[1].match(/<kind[^>]*>([^<]*)</)?.[1] ?? 'major';
        const name = names[pc] + (KIND[kind] ?? '');
        chords.set(name, (chords.get(name) ?? 0) + 1);
      }
      const dv = m.match(/<divisions>(\d+)/);
      if (dv) divisions = +dv[1];
      let pos = 0, last = 0;
      for (const [, kind, n] of m.matchAll(/<(note|backup|forward)>([\s\S]*?)<\/\1>/g)) {
        const dur = Number(n.match(/<duration>(\d+)/)?.[1] ?? 0);
        if (kind === 'backup') { pos -= dur; continue; }
        if (kind === 'forward') { pos += dur; continue; }
        const chord = n.includes('<chord');
        const start = chord ? last : pos;
        if (!chord) { last = pos; pos += dur; }
        if (n.includes('<rest')) continue;
        const p = n.match(/<step>(\w)<\/step>(?:\s*<alter>(-?\d)<\/alter>)?\s*<octave>(\d)/);
        if (!p) continue;
        if (!n.includes('<tie type="stop"')) {
          notes++;
          onsets.push(t + (start / divisions) * (60 / tempo));
        }
        const midi = 12 * (+p[3] + 1) + STEP[p[1]] + Number(p[2] ?? 0);
        low = Math.min(low, midi);
        high = Math.max(high, midi);
      }
      // a quarter lasts 60/tempo seconds; the bar lasts beats × (4 / beatType) quarters
      t += beats * (4 / beatType) * (60 / tempo);
    }
    starts.push(+t.toFixed(3));
    const name = partNames.find(([p]) => p === id)?.[1] ?? id;
    parts.push({ name: name.toLowerCase(), notes, low: notes ? noteName(low) : undefined, high: notes ? noteName(high) : undefined });
    if (!bars.length) bars = starts;
    if (!sections.length) sections = marks;
  }

  return {
    key: `${(mode === 'minor' ? MINOR : MAJOR)[fifths + 7]} ${mode}`,
    tempo: [...tempos],
    meter: [...meters],
    bars,
    parts,
    sections,
    chords: [...chords.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c),
    onsets,
  };
}

// ---- line the paper up with the recording.
// The machine's score keeps its own clock: it can start a beat or two late and run
// slightly fast or slow. Fit audio = a·paper + b by matching the score's note onsets
// to the recording's onsets, then move each section mark to the nearby bar line
// where the sound changes most (the marks can be a bar off).
const SR = 11025, HOP = 110, FPS = SR / HOP; // ~10 ms frames
function loudness(file) {
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  const x = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length / 4);
  const e = new Float32Array(Math.floor(x.length / HOP));
  for (let i = 0; i < e.length; i++) {
    let sum = 0;
    for (let j = 0; j < HOP; j++) sum += x[i * HOP + j] ** 2;
    e[i] = Math.log(1e-6 + sum);
  }
  return e;
}
function align(summary, energy) {
  const flux = energy.map((v, i) => (i ? Math.max(0, v - energy[i - 1]) : 0));
  const fit = (a, b) => {
    let s = 0;
    for (const o of summary.onsets) {
      const f = Math.round((a * o + b) * FPS);
      if (f > 0 && f < flux.length - 1) s += Math.max(flux[f - 1], flux[f], flux[f + 1]);
    }
    return s;
  };
  let best = { s: fit(1, 0), a: 1, b: 0 };
  for (let a = 0.97; a <= 1.03; a += 0.0005)
    for (let b = -6; b <= 6; b += 0.02) {
      const s = fit(a, b);
      if (s > best.s) best = { s, a, b };
    }
  const at = (t) => +(best.a * t + best.b).toFixed(3);
  const bars = summary.bars.map(at);
  // average loudness of bar i, and how much it differs from the bar before
  const level = (i) => {
    const from = Math.max(0, Math.round(bars[i] * FPS));
    const to = Math.min(energy.length, Math.round(bars[i + 1] * FPS));
    let s = 0;
    for (let f = from; f < to; f++) s += energy[f];
    return to > from ? s / (to - from) : -14;
  };
  const change = (i) => (i <= 0 || i >= bars.length - 1 ? 0 : Math.abs(level(i) - level(i - 1)));
  const sections = summary.sections.map((s) => {
    let bar = s.bar - 1;
    if (bar > 0) {
      let top = bar;
      for (let j = bar - 2; j <= bar + 2; j++) if (j > 0 && change(j) > change(top)) top = j;
      if (change(top) > 1.5 * change(bar) && change(top) > 0.35) bar = top;
    }
    return { name: s.name, bar: bar + 1, at: +Math.max(0, bars[bar]).toFixed(2) };
  });
  return { bars, sections, shift: { stretch: +best.a.toFixed(4), offset: +best.b.toFixed(2) } };
}

const data = existsSync(dataFile) ? JSON.parse(readFileSync(dataFile, 'utf8')) : {};
let added = 0;
for (const file of readdirSync(folder).filter((f) => extname(f) === '.musicxml')) {
  const title = basename(file, '.musicxml');
  const song = library.find((s) => norm(s.title) === norm(title));
  if (!song) { console.log(`  ?  ${file}: no song with audio by that name`); continue; }
  const id = basename(song.audio, extname(song.audio));
  const files = {};
  // the machine's PDF prints the account name, so it stays out; the MusicXML loses its creator line
  for (const ext of ['musicxml', 'mid']) {
    const source = join(folder, `${title}.${ext}`);
    if (!existsSync(source)) continue;
    const target = join(out, `${id}.${ext}`);
    if (ext === 'musicxml') writeFileSync(target, readFileSync(source, 'utf8').replace(/<creator\b[^>]*>[^<]*<\/creator>/g, ''));
    else copyFileSync(source, target);
    files[ext] = { src: `/score/${id}.${ext}`, size: statSync(target).size };
  }
  const { onsets, ...summary } = summarise(readFileSync(join(folder, file), 'utf8'));
  const aligned = align({ ...summary, onsets }, loudness(join(root, 'public', song.audio)));
  const moved = aligned.sections.filter((s, i) => s.bar !== summary.sections[i].bar).map((s) => s.name.toLowerCase());
  data[song.audio] = { ...summary, ...aligned, files };
  console.log(`  ✓  ${title} → ${song.audio}  (${summary.key}, ${summary.bars.length - 1} bars; paper ×${aligned.shift.stretch} ${aligned.shift.offset >= 0 ? '+' : ''}${aligned.shift.offset}s${moved.length ? `; moved ${moved.join(', ')}` : ''})`);
  added++;
}
writeFileSync(dataFile, JSON.stringify(data, null, 0).replace(/\],"/g, '],\n"') + '\n');
console.log(`\n${added} scores in src/data/scores.json`);
