// Everything the command palette can find, built once as a static file.
import type { APIRoute } from 'astro';
import {
  getCatalog,
  releaseUrl,
  trackUrl,
  hasAudio,
  isUnfinished,
  playable,
  parseLyrics,
  fmtTime,
} from '../lib/catalog';

export const GET: APIRoute = async () => {
  const { releases, tracksOf } = await getCatalog();
  const queues: Record<string, ReturnType<typeof playable>[]> = {};
  const records = [];
  const tracks = [];

  for (const r of releases) {
    const all = tracksOf(r.id);
    const ready = all.filter(hasAudio);
    queues[r.id] = ready.map((t) => playable(t, r));
    records.push({
      id: r.id,
      title: r.data.title,
      meta: `${r.data.catalog} · ${r.data.kind}${isUnfinished(r) ? ' · unfinished' : ''} · ${all.length} tracks`,
      url: releaseUrl(r.id),
      cover: r.data.cover?.replace(/\.webp$/, '-480.webp'),
      playable: ready.length > 0,
    });
    for (const t of all) {
      // only sung/spoken lines are searchable, not the [directions]
      const lines = parseLyrics(t.body)
        .flat()
        .filter((l) => !l.direction)
        .map((l) => l.text);
      tracks.push({
        title: t.data.title,
        release: r.data.title,
        releaseId: r.id,
        meta: `${r.data.title} · ${String(t.data.number).padStart(2, '0')} · ${fmtTime(t.data.duration)}`,
        url: trackUrl(t),
        index: ready.indexOf(t),
        tags: t.data.tags ?? '',
        lyrics: lines,
      });
    }
  }

  return new Response(JSON.stringify({ records, tracks, queues }), {
    headers: { 'content-type': 'application/json' },
  });
};
