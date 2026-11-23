// Structured data (schema.org JSON-LD) and other SEO helpers.
// Search engines read these to understand the site: a band, its albums,
// its songs and its news.
import { site } from '../site';

export const SITE_URL = 'https://plausiblestrangers.com';
export const abs = (path: string) => new URL(path, SITE_URL).href;

/** seconds → ISO 8601 duration, e.g. 210 → "PT3M30S" */
export const isoDuration = (sec: number) => {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}${s % 60}S`;
};

export const BAND_ID = `${SITE_URL}/#band`;
/** a reference to the band, for byArtist / author fields */
export const bandRef = { '@type': 'MusicGroup', '@id': BAND_ID, name: 'Plausible Strangers' };

export const band = (extra: Record<string, unknown> = {}) => ({
  '@type': 'MusicGroup',
  '@id': BAND_ID,
  name: 'Plausible Strangers',
  alternateName: 'plausible strangers.',
  url: SITE_URL + '/',
  description: site.description,
  image: abs('/art/about/plausible-strangers.jpg'),
  genre: ['Electronic', 'Electroclash', 'House', 'Techno', 'Experimental'],
  sameAs: site.links.map((l) => l.href),
  ...extra,
});

export const website = () => ({
  '@type': 'WebSite',
  '@id': `${SITE_URL}/#website`,
  name: 'plausible strangers.',
  url: SITE_URL + '/',
  inLanguage: 'en',
  publisher: { '@id': BAND_ID },
  // the library filters by ?q=, so search engines can offer a search box
  potentialAction: {
    '@type': 'SearchAction',
    target: { '@type': 'EntryPoint', urlTemplate: `${SITE_URL}/library/?q={search_term_string}` },
    'query-input': 'required name=search_term_string',
  },
});

export const breadcrumbs = (items: [string, string][]) => ({
  '@type': 'BreadcrumbList',
  itemListElement: items.map(([name, path], i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name,
    item: abs(path),
  })),
});

/** wrap one or more nodes into a single JSON-LD document */
export const graph = (...nodes: unknown[]) => ({ '@context': 'https://schema.org', '@graph': nodes.filter(Boolean) });
