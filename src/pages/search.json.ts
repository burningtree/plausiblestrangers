// Everything the command palette can find, built once as a static file.
import type { APIRoute } from 'astro';
import {
  getCatalog,
  releaseUrl,
  trackUrl,
  hasAudio,
  isUnfinished,
  playable,
  performedLyrics,
  hasReviewedPerformance,
  fmtTime,
  fmtDate,
  getArchive,
  playableArchive,
  archiveUrl,
} from '../lib/catalog';

export const GET: APIRoute = async () => {
  const { releases, tracksOf } = await getCatalog();
  const queues: Record<string, (ReturnType<typeof playable> | NonNullable<ReturnType<typeof playableArchive>>)[]> = {};
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
      const index = ready.indexOf(t);
      const lines = hasReviewedPerformance(t.data.audio)
        ? queues[r.id][index]?.lyrics?.map((line) => line.text) ?? []
        : performedLyrics(t.body, t.data.audio).flat().map((line) => line.text);
      tracks.push({
        title: t.data.title,
        release: r.data.title,
        releaseId: r.id,
        meta: `${r.data.title} · ${String(t.data.number).padStart(2, '0')} · ${fmtTime(t.data.duration)}`,
        url: trackUrl(t),
        index,
        tags: t.data.tags ?? '',
        lyrics: lines,
      });
    }
  }

  for (const a of await getArchive()) {
    const recording = playableArchive(a);
    if (recording) queues[recording.id] = [recording];
    tracks.push({
      title: a.data.title,
      release: 'archive',
      releaseId: recording?.id ?? '',
      meta: `archive · unreleased${a.data.created ? ` · ${fmtDate(a.data.created)}` : ''}`,
      url: archiveUrl(a),
      index: recording ? 0 : -1,
      tags: a.data.tags ?? '',
      lyrics: a.data.lyricsHidden
        ? []
        : hasReviewedPerformance(a.data.audio)
          ? recording?.lyrics?.map((line) => line.text) ?? []
          : performedLyrics(a.body, a.data.audio).flat().map((line) => line.text),
      archive: true,
    });
  }

  return new Response(JSON.stringify({ records, tracks, queues }), {
    headers: { 'content-type': 'application/json' },
  });
};
