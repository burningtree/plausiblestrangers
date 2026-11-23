import { getCollection, type CollectionEntry } from 'astro:content';
import peaksData from '../data/peaks.json';

export type Release = CollectionEntry<'releases'>;
export type Track = CollectionEntry<'tracks'>;

const peaks = peaksData as Record<string, number[]>;

export const isAlbum = (r: Release) => r.data.kind.toLowerCase() === 'album';
export const isUnfinished = (r: Release) => r.data.status === 'unfinished';
export const hasAudio = (t: Track) => Boolean(t.data.audio);

export const trackSlug = (t: Track) => t.id.split('/').pop()!.replace(/^\d+-/, '');
export const releaseUrl = (slug: string) => `/records/${slug}/`;
export const trackUrl = (t: Track) => `/records/${t.data.release}/${trackSlug(t)}/`;
export const trackPeaks = (t: Track) => peaks[`${t.data.release}/${trackSlug(t)}`] ?? [];

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
});
