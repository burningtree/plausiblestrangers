import { getCollection, type CollectionEntry } from 'astro:content';
import peaksData from '../data/peaks.json';
import syncData from '../data/lyric-sync.json';
import performanceData from '../data/lyric-performances.json';
import blurData from '../data/blurhash.json';
import analysisData from '../data/analysis.json';
import { hasCompleteWordTiming, type StoredLine, type TimedLyric, type TimedWord } from './lyric-timing';

export type Release = CollectionEntry<'releases'>;
export type Track = CollectionEntry<'tracks'>;
export type ArchiveSong = CollectionEntry<'archive'>;

// Blurry placeholder (from scripts/blurhash.mjs) to sit behind an <img> while it loads.
// Thumbnails (-480, -640) share their full-size image's placeholder.
const blurs = blurData as Record<string, { hash: string; png: string }>;
export const blurStyle = (src?: string) => {
  const b = src && blurs[src.replace(/-(480|640)(\.\w+)$/, '$2')];
  return b ? `background-image:url(${b.png})` : undefined;
};

// ---- sound analysis (scripts/analyse.mjs)
export type Analysis = {
  cols: number;
  bands: number;
  fLo: number;
  fHi: number;
  spec: string;
  balance: Record<string, number>;
  brightness: number;
  width: number;
  peak: number;
  lufs: number | null;
  lra: number | null;
  busiest: number;
};
const analyses = analysisData as Record<string, Analysis>;
export const trackAnalysis = (t: Track): Analysis | undefined => analyses[`${t.data.release}/${trackSlug(t)}`];

// where a value sits among all our songs (each recording counted once): 0–100
const uniqueAnalyses = [...new Map(Object.values(analyses).map((a) => [a.spec, a])).values()];
export function percentile(metric: 'lufs' | 'lra' | 'brightness' | 'width', value: number | null) {
  if (value == null) return undefined;
  const vals = uniqueAnalyses.map((a) => a[metric]).filter((v): v is number => v != null);
  const below = vals.filter((v) => v < value).length;
  return Math.round((below / Math.max(1, vals.length - 1)) * 100);
}

// spectrogram colour steps, taken from all our songs together so pictures compare:
// the quietest ~40% stay dark, then three steps of ink, the top ~5% in the accent
export const spectroLevels = (() => {
  const all: number[] = [];
  for (const a of uniqueAnalyses) for (const ch of atob(a.spec)) all.push(ch.charCodeAt(0));
  all.sort((x, y) => x - y);
  const q = (p: number) => all[Math.floor(p * (all.length - 1))] ?? 0;
  return [0.4, 0.62, 0.82, 0.95].map(q);
})();

// a small version of a spectrogram (averaged down) for lists like the library
export const MINI = { cols: 128, bands: 14 };
const miniCache = new Map<string, Uint8Array>();
function miniBytes(a: Analysis) {
  let m = miniCache.get(a.spec);
  if (m) return m;
  const src = Uint8Array.from(atob(a.spec), (c) => c.charCodeAt(0));
  m = new Uint8Array(MINI.cols * MINI.bands);
  for (let c = 0; c < MINI.cols; c++)
    for (let b = 0; b < MINI.bands; b++) {
      const c0 = Math.floor((c * a.cols) / MINI.cols), c1 = Math.floor(((c + 1) * a.cols) / MINI.cols);
      const b0 = Math.floor((b * a.bands) / MINI.bands), b1 = Math.floor(((b + 1) * a.bands) / MINI.bands);
      let sum = 0, n = 0;
      for (let x = c0; x < c1; x++) for (let y = b0; y < b1; y++) (sum += src[x * a.bands + y]), n++;
      m[c * MINI.bands + b] = Math.round(sum / Math.max(1, n));
    }
  miniCache.set(a.spec, m);
  return m;
}
export const miniSpec = (a: Analysis) => btoa(String.fromCharCode(...miniBytes(a)));
export const miniLevels = (() => {
  const all = uniqueAnalyses.flatMap((a) => [...miniBytes(a)]).sort((x, y) => x - y);
  const q = (p: number) => all[Math.floor(p * (all.length - 1))] ?? 0;
  return [0.4, 0.62, 0.82, 0.95].map(q);
})();

export const archiveUrl = (a: ArchiveSong) => `/library/${a.id}/`;
export async function getArchive() {
  return (await getCollection('archive', (a) => !a.data.hidden)).sort(
    (a, b) => (b.data.created?.getTime() ?? 0) - (a.data.created?.getTime() ?? 0),
  );
}

// "R.U.R. - Original Version" and "R.U.R." are versions of the same song
export const songBase = (title: string) =>
  title
    .split(/\s+[-–—]\s+/)[0]
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

export const splitTags = (tags?: string) =>
  (tags ?? '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

const peaks = peaksData as Record<string, number[]>;
// [start, end, confidence] per sung line, made by scripts/sync_lyrics.py
const lyricSync = syncData as unknown as Partial<Record<string, StoredLine[]>>;

export const isAlbum = (r: Release) => r.data.kind.toLowerCase() === 'album';
export const isUnfinished = (r: Release) => r.data.status === 'unfinished';
export const hasAudio = (t: Track) => Boolean(t.data.audio);

export const trackSlug = (t: Track) => t.id.split('/').pop()!.replace(/^\d+-/, '');
export const releaseUrl = (slug: string) => `/records/${slug}/`;

// ---- news
export type NewsPost = CollectionEntry<'news'>;
export const newsUrl = (n: NewsPost) => `/news/${n.id}/`;
export async function getNews() {
  return (await getCollection('news', (n) => !n.data.draft)).sort(
    (a, b) => b.data.date.getTime() - a.data.date.getTime(),
  );
}
export const trackUrl = (t: Track) => `/records/${t.data.release}/${trackSlug(t)}/`;
export const trackPeaks = (t: Track) => peaks[`${t.data.release}/${trackSlug(t)}`] ?? [];
/** A friendly file name for downloads: "Plausible Strangers - R.U.R..m4a" */
export const downloadName = (t: Track) =>
  `Plausible Strangers - ${t.data.title.replace(/[\\/:*?"<>|]+/g, '-')}.${t.data.audio?.split('.').pop() ?? 'm4a'}`;

function lyricsFor(key: string, body: string | undefined, duration: number, audio?: string): TimedLyric[] | undefined {
  const sync = lyricSync[key];
  if (!sync) return;
  const lines = performedLyrics(body, audio).flat();
  if (lines.length !== sync.length) return;
  const cues: TimedLyric[] = [];
  let previousEnd = 0;
  for (const [index, { text }] of lines.entries()) {
    const stored = sync[index];
    if (!stored || stored[0] !== text) continue;
    const words: TimedWord[] = [];
    let right = 0;
    for (const [from, to, start, end] of stored[1]) {
      const e = Math.min(duration, end);
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < right || to <= from || to > text.length
        || !Number.isFinite(start) || !Number.isFinite(e) || start < previousEnd || e <= start) continue;
      words.push({ index: from, end: to, t: start, e });
      right = to;
      previousEnd = e;
    }
    if (words.length && hasCompleteWordTiming(text, words)) {
      cues.push({ index, text, t: words[0].t, e: words[words.length - 1].e, words });
    }
  }
  return cues.length ? cues : undefined;
}

export function timedLyrics(t: Track) {
  if (!t.data.instrumental) return lyricsFor(`${t.data.release}/${trackSlug(t)}`, t.body, t.data.duration, t.data.audio);
}

export async function getCatalog() {
  // albums first, then EPs and singles; finished before unfinished; newest first
  const releases = (await getCollection('releases', (r) => !r.data.hidden)).sort(
    (a, b) =>
      Number(isAlbum(b)) - Number(isAlbum(a)) ||
      Number(isUnfinished(a)) - Number(isUnfinished(b)) ||
      b.data.catalog.localeCompare(a.data.catalog),
  );
  const allTracks = await getCollection('tracks');
  const tracksOf = (slug: string) =>
    allTracks.filter((t) => t.data.release === slug).sort((a, b) => a.data.number - b.data.number);
  return { releases, tracksOf };
}

export const fmtTime = (s: number) => {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

export const fmtTotal = (s: number) => {
  const m = Math.round(s / 60);
  return `${m} min`;
};

export const fmtDate = (d?: Date) =>
  d
    ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).toLowerCase()
    : 'undated';

// Open Key notation (what the analyser writes into the WAVs) → musical key.
const OPEN_KEY_MINOR = ['A', 'E', 'B', 'F♯', 'D♭', 'A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D'];
const OPEN_KEY_MAJOR = ['C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'D♭', 'A♭', 'E♭', 'B♭', 'F'];
export const keyName = (k?: string) => {
  const m = k?.match(/^(\d{1,2})([md])$/);
  if (!m) return k;
  const i = Number(m[1]) - 1;
  return m[2] === 'm' ? `${OPEN_KEY_MINOR[i]} minor` : `${OPEN_KEY_MAJOR[i]} major`;
};

// Lyrics → stanzas of lines; [bracketed] lines become directions.
export type LyricLine = { text: string; direction: boolean };
export function parseLyrics(body = ''): LyricLine[][] {
  const stanzas: LyricLine[][] = [];
  let current: LyricLine[] = [];
  const flush = () => {
    if (current.length) stanzas.push(current);
    current = [];
  };
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const direction = /^\[.*\]$/.test(line);
    if (direction) {
      flush();
      stanzas.push([{ text: line.slice(1, -1), direction: true }]);
    } else {
      current.push({ text: line, direction: false });
    }
  }
  flush();
  return stanzas;
}

type PerformanceEdit = { line: number; prompt: string; lines: string[] };
const performanceEdits: Partial<Record<string, PerformanceEdit[]>> = performanceData;

export const hasReviewedPerformance = (audio?: string) => !!(audio && performanceEdits[audio]);

export function performedLyrics(body?: string, audio?: string): LyricLine[][] {
  const edits = new Map((audio ? performanceEdits[audio] ?? [] : []).map((edit) => [edit.line, edit]));
  let index = 0;
  return parseLyrics(body).filter(([line]) => !line.direction).map((stanza) =>
    stanza.flatMap((line) => {
      const edit = edits.get(index++);
      return edit?.prompt === line.text ? edit.lines.map((text) => ({ text, direction: false })) : [line];
    }),
  ).filter((stanza) => stanza.length > 0);
}

// What the player needs to know about a track.
export const playable = (t: Track, r: Release) => ({
  id: `${t.data.release}/${trackSlug(t)}`,
  title: t.data.title,
  release: r.data.title,
  src: t.data.audio!,
  url: trackUrl(t),
  cover: r.data.cover?.replace(/\.webp$/, '-480.webp'),
  duration: t.data.duration,
  peaks: trackPeaks(t),
  lyrics: timedLyrics(t),
  bpm: t.data.bpm,
});

export function playableArchive(song: ArchiveSong) {
  const { audio, title, duration, bpm } = song.data;
  if (!audio) return undefined;

  const id = `archive/${song.id}`;
  const lyrics = !song.data.instrumental && !song.data.lyricsHidden ? lyricsFor(id, song.body, duration ?? Infinity, audio) : undefined;
  return { id, title, release: 'archive', src: audio, url: archiveUrl(song), duration: duration ?? 0, peaks: peaks[id] ?? [], bpm, lyrics };
}
