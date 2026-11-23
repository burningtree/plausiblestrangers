#!/usr/bin/env node
// Artist photos for the "who inspires us" grid, from the Spotify Web API.
//
//   npm run influences:spotify            # look up artists not matched yet
//   npm run influences:spotify -- --all   # refresh everyone
//
// Needs a (free) Spotify developer app: https://developer.spotify.com/dashboard
// Put its credentials in web/.env (never committed):
//   SPOTIFY_CLIENT_ID=...
//   SPOTIFY_CLIENT_SECRET=...
//
// Writes src/data/influences-spotify.json: { "<slug>": { id, name, url, image } }.
// Only the image *address* is stored; the picture itself stays on Spotify's
// servers, shown unaltered and linked back to the artist, as Spotify's
// developer terms ask.
//
// Wrong match (e.g. "Air", "DVA")? Open the right artist on Spotify, copy the id
// from its link (open.spotify.com/artist/<id>), put it in the JSON as "id" for
// that slug, delete its "image", and run again: pinned ids are fetched directly.

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src/data/influences-spotify.json');
const ALL = process.argv.includes('--all');
const { SPOTIFY_CLIENT_ID: id, SPOTIFY_CLIENT_SECRET: secret } = process.env;

if (!id || !secret) {
  console.error('Missing SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET (put them in web/.env).');
  process.exit(1);
}

// same names and slugs as src/data/influences.ts
const src = await readFile(path.join(ROOT, 'src/data/influences.ts'), 'utf8');
// each entry looks like { name: '…', tier: n, slug?: '…', … }
const entries = [...src.matchAll(/\{\s*name:\s*'([^']+)'[^}]*?\}/g)].map((m) => ({
  name: m[1],
  slug: m[0].match(/slug:\s*'([^']+)'/)?.[1],
}));
const norm = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/å/gi, 'a')
    .toLowerCase();
const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const same = (a, b) => norm(a).replace(/[^a-z0-9]/g, '') === norm(b).replace(/[^a-z0-9]/g, '');

const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
  method: 'POST',
  headers: {
    Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  body: 'grant_type=client_credentials',
});
if (!tokenRes.ok) {
  console.error(`Spotify login failed (${tokenRes.status}). Check the credentials in web/.env.`);
  process.exit(1);
}
const { access_token } = await tokenRes.json();

async function api(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${access_token}` } });
    if (res.status === 429) {
      // rate limited: wait as long as Spotify asks
      await new Promise((r) => setTimeout(r, (Number(res.headers.get('retry-after')) || 2) * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.json();
  }
  throw new Error(`rate limited: ${url}`);
}

const pick = (images = []) =>
  // the smallest image that is still at least 320px, else the largest
  [...images].sort((a, b) => a.width - b.width).find((i) => i.width >= 320)?.url ?? images[0]?.url;

const data = existsSync(OUT) ? JSON.parse(await readFile(OUT, 'utf8')) : {};
for (const { name, slug: fixed } of entries) {
  const key = fixed ?? slug(name);
  const known = data[key];
  if (known?.image && known?.imageLarge && !ALL) continue;
  let artist;
  if (known?.id) {
    artist = await api(`https://api.spotify.com/v1/artists/${known.id}`); // pinned by hand
  } else {
    const q = encodeURIComponent(`artist:${name}`);
    const found = (await api(`https://api.spotify.com/v1/search?type=artist&limit=10&q=${q}`)).artists.items;
    // exact name first, then the best-known of the rest
    artist = found.find((a) => same(a.name, name)) ?? found[0];
  }
  if (!artist) {
    console.log(`  ?  ${name}: not found`);
    continue;
  }
  data[key] = {
    id: artist.id,
    name: artist.name,
    url: artist.external_urls?.spotify ?? `https://open.spotify.com/artist/${artist.id}`,
    image: pick(artist.images),
    // the largest one, for the big tiles
    imageLarge: [...(artist.images ?? [])].sort((a, b) => b.width - a.width)[0]?.url,
  };
  const flag = same(artist.name, name) ? '✓' : '≈';
  console.log(`  ${flag}  ${name} → ${artist.name}${data[key].image ? '' : ' (no image)'}  ${data[key].url}`);
}
await writeFile(OUT, JSON.stringify(data, null, 2) + '\n');
console.log(`\nwrote ${path.relative(ROOT, OUT)}. Lines with ≈ matched a different name: check them.`);
