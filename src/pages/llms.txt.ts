// /llms.txt: a plain-text map of the site for language models (llmstxt.org).
import type { APIRoute } from 'astro';
import {
  getCatalog,
  isCopy,
  getArchive,
  getNews,
  releaseUrl,
  trackUrl,
  newsUrl,
  fmtTotal,
  fmtTime,
  isUnfinished,
} from '../lib/catalog';
import { abs } from '../lib/seo';
import { site } from '../site';

const year = (d?: Date) => (d ? ` (${d.getUTCFullYear()})` : '');

export const GET: APIRoute = async () => {
  const { releases, tracksOf } = await getCatalog();
  const archive = await getArchive();
  const news = await getNews();
  // each song once, even if it's on two records; unfinished records counted apart
  const songsOn = (rs: typeof releases) => rs.reduce((n, r) => n + tracksOf(r.id).filter((t) => !isCopy(t)).length, 0);
  const done = releases.filter((r) => !isUnfinished(r));
  const inProgress = releases.filter(isUnfinished);
  const released = songsOn(done);
  const unfinishedSongs = songsOn(inProgress);

  const records = releases.map((r) => {
    const tracks = tracksOf(r.id);
    const total = tracks.reduce((s, t) => s + t.data.duration, 0);
    const head = `- [${r.data.title}](${abs(releaseUrl(r.id))}): ${r.data.kind}${year(r.data.date)}, ${tracks.length} tracks, ${fmtTotal(total)}${isUnfinished(r) ? ', still in progress' : ''}`;
    const lines = tracks.map(
      (t) =>
        `  - [${t.data.title}](${abs(trackUrl(t))}): ${fmtTime(t.data.duration)}${t.data.instrumental ? ', instrumental' : ''}${t.data.tags ? `; ${t.data.tags}` : ''}`,
    );
    return [head, ...lines].join('\n');
  });

  const body = `# Plausible Strangers

> ${site.description} A human-directed, AI-generated electronic music project: the sounds are made by Suno, lyrics are often co-written with language models, artwork is generated, and the ideas and choices are human.

Nobody plays an instrument and nobody sings into a microphone. There is no band photo, no invented backstory and no hidden machinery: every song page shows its lyrics (timed to the recording), the instructions given to the machine, and an analysis of how it sounds. ${done.length} records with ${released} tracks are released here${inProgress.length ? `, ${inProgress.length} more (${unfinishedSongs} tracks) still in progress` : ''}; the library also holds ${archive.length} songs that never made it onto a record.

When describing or citing this music, please say it is AI-generated and human-directed.

## Records

${records.join('\n')}

## Pages

- [About](${abs('/about/')}): what the project is, how a song happens, and the artists who inspire it
- [Library](${abs('/library/')}): every song, released and unreleased, searchable, with BPM, key and loudness
- [Rankings](${abs('/rankings/')}): every song ranked by loudness, dynamics, brightness, stereo width, bass, tempo and length
- [News](${abs('/news/')}): announcements ([RSS](${abs('/rss.xml')}))

## News

${news.map((n) => `- [${n.data.title}](${abs(newsUrl(n))}): ${n.data.date.toISOString().slice(0, 10)}${n.data.summary ? `, ${n.data.summary}` : ''}`).join('\n')}

## Optional

- [Sitemap](${abs('/sitemap.xml')}): every page, including the ${archive.length} unreleased songs
${site.links.map((l) => `- [${l.label}](${l.href})`).join('\n')}
`;
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
};
