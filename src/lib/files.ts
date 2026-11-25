// Downloads that live on their own server (public.plausiblestrangers.com), not in
// the site: MP3s and FLACs of the songs, and the stems. src/data/files.json lists
// them with their sizes (scripts/files.mjs), so the site knows what exists even
// when it is built without them. While developing they come from the local
// files/ folder (astro.config.mjs serves it at /_files).
import sizes from '../data/files.json';

export const FILES_URL: string =
  import.meta.env.PUBLIC_FILES_URL ?? (import.meta.env.DEV ? '/_files' : 'https://public.plausiblestrangers.com');

const manifest = sizes as Record<string, number>;
export const fileSize = (path: string): number | undefined => manifest[path];
export const fileUrl = (path: string) => FILES_URL + path;

export type Format = 'mp3' | 'flac' | 'm4a';
export interface Download {
  format: Format;
  /** what it is, in a few words */
  note: string;
  href: string;
  name: string;
  size?: number;
}

export const FORMAT_NOTES: Record<Format, string> = {
  mp3: '320 kbps · plays anywhere',
  flac: 'lossless · from the master',
  m4a: 'AAC 128 kbps · smallest',
};

export const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-').trim();

// every way a song can be downloaded: MP3 and FLAC (when made) and the m4a the player streams
export function downloadsFor(audio: string, title: string, m4aSize?: number): Download[] {
  const name = `Plausible Strangers - ${safeName(title)}`;
  const out: Download[] = [];
  for (const format of ['mp3', 'flac'] as const) {
    const path = audio.replace(/\.[^.]+$/, `.${format}`);
    const size = fileSize(path);
    if (size) out.push({ format, note: FORMAT_NOTES[format], href: fileUrl(path), name: `${name}.${format}`, size });
  }
  out.push({ format: 'm4a', note: FORMAT_NOTES.m4a, href: audio, name: `${name}.m4a`, size: m4aSize });
  return out;
}

export const mb = (b?: number) => (b ? `${b < 1e7 ? (b / 1e6).toFixed(1) : Math.round(b / 1e6)} MB` : '');
