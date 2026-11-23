// Every page, for search engines. Referenced from public/robots.txt.
import type { APIRoute } from 'astro';
import { getCatalog, getArchive, getNews, releaseUrl, trackUrl, archiveUrl, newsUrl } from '../lib/catalog';
import { abs } from '../lib/seo';

type Entry = { path: string; lastmod?: Date; priority: number };

export const GET: APIRoute = async () => {
  const { releases, tracksOf } = await getCatalog();
  const archive = await getArchive();
  const news = await getNews();
  const latest = (dates: (Date | undefined)[]) =>
    dates.filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];

  const entries: Entry[] = [
    { path: '/', priority: 1, lastmod: latest([...releases.map((r) => r.data.date), ...news.map((n) => n.data.date)]) },
    { path: '/about/', priority: 0.8 },
    { path: '/library/', priority: 0.8 },
    { path: '/rankings/', priority: 0.5 },
    { path: '/news/', priority: 0.6, lastmod: news[0]?.data.date },
    ...releases.flatMap((r) => {
      const tracks = tracksOf(r.id);
      return [
        { path: releaseUrl(r.id), priority: 0.9, lastmod: r.data.date ?? latest(tracks.map((t) => t.data.created)) },
        ...tracks.map((t) => ({ path: trackUrl(t), priority: 0.7, lastmod: t.data.created })),
      ];
    }),
    ...archive.map((a) => ({ path: archiveUrl(a), priority: 0.4, lastmod: a.data.created })),
    ...news.map((n) => ({ path: newsUrl(n), priority: 0.6, lastmod: n.data.date })),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
  .map(
    (e) =>
      `  <url><loc>${abs(e.path)}</loc>${e.lastmod ? `<lastmod>${e.lastmod.toISOString().slice(0, 10)}</lastmod>` : ''}<priority>${e.priority.toFixed(1)}</priority></url>`,
  )
  .join('\n')}
</urlset>
`;
  return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
};
