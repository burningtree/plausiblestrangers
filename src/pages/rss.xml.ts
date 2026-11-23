// RSS feed of the news, so people can follow without visiting.
import type { APIRoute } from 'astro';
import { getNews, newsUrl } from '../lib/catalog';
import { site } from '../site';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

export const GET: APIRoute = async ({ site: base }) => {
  const origin = (base ?? new URL('https://plausiblestrangers.com')).origin;
  const posts = await getNews();
  const items = posts
    .map((p) => {
      const url = `${origin}${newsUrl(p)}`;
      return `    <item>
      <title>${esc(p.data.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${p.data.date.toUTCString()}</pubDate>${p.data.summary ? `\n      <description>${esc(p.data.summary)}</description>` : ''}
    </item>`;
    })
    .join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(site.name)} news</title>
    <link>${origin}/news/</link>
    <atom:link href="${origin}/rss.xml" rel="self" type="application/rss+xml" />
    <description>${esc(site.description)}</description>
    <language>en</language>${posts[0] ? `\n    <lastBuildDate>${posts[0].data.date.toUTCString()}</lastBuildDate>` : ''}
${items}
  </channel>
</rss>
`;
  return new Response(xml, { headers: { 'content-type': 'application/rss+xml; charset=utf-8' } });
};
