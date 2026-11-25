# The website: how it works

plausiblestrangers.com is a small static Astro site. No analytics, no cookies, no UI framework.
(For what the band is, see the [README](../README.md).)

```
npm install
npm run dev        # http://localhost:4321
npm run build      # static site in dist/
```

## Where things live

| what                          | where                                         |
| ----------------------------- | --------------------------------------------- |
| home page copy                | `src/pages/index.astro`                       |
| links, contact, license       | `src/site.ts`                                 |
| a record (title, date, notes) | `src/content/releases/<slug>.md`              |
| a track (lyrics, notes, info) | `src/content/tracks/<record>/<nn>-<slug>.md`  |
| audio / covers                | `public/audio/…`, `public/covers/…`           |
| styles                        | `src/styles/global.css`                       |
| the player                    | `src/components/Player.astro`                 |

Track files: the frontmatter holds the facts (`bpm`, `key`, `style` = the prompt
given to the machine, optional `notes`), and the body is the lyrics as plain text.
Lines in `[brackets]` are shown as stage directions. Records can be hidden with
`hidden: true`.

Extra images (concept art, outtakes) go in `public/art/<record>/` and are listed
under `gallery:` in the record's markdown, each with `src`, `alt` (a description
for people who can't see it) and an optional `caption`. Put a 640px version next
to each image with `-640` in the name for the thumbnail, e.g.:

```
magick photo.jpg -resize 1600x1600 -quality 82 public/art/my-record/01.webp
magick photo.jpg -resize 640x640 -quality 76 public/art/my-record/01-640.webp
```

Records can also be marked `status: "unfinished"`: they get a stamp and sort
after the released ones. Tracks without `audio:` show their words but no player.

## Adding a new record

Put it in the music folder like the others (`006-NEW-THING-EP/01-track.wav`,
`cover-upscaled.jpg`), make it a public playlist on Suno with the same name, then:

```
npm run import -- "/path/to/My Music/Plausible Strangers"
```

This encodes AAC (.m4a) (needs `ffmpeg` and ImageMagick `magick`), resizes covers,
computes waveforms and pulls lyrics + style prompts from Suno. It never
overwrites markdown you already edited (`--rewrite` forces that, `--force`
re-encodes audio and covers).

Then refresh the sound data (each only does files it hasn't seen yet):

```
npm run analyse    # spectrogram, energy balance, loudness… (src/data/analysis.json)
npm run peaks      # fine waveform, 4 values a second (src/data/peaks-hd.json)
npm run spectro    # fine spectrogram, 2 slices a second (src/data/spectro-hd.json)
```

### One song on two records

A recording can be on more than one record (a single that's also on the album):
give both track files the same `audio:` path. Each record keeps it in its
tracklist, but the site treats it as one song: one page (on the released,
earliest record; the other address redirects there), one row in the library,
counted once.

## The archive (/library)

Songs that never made it onto a record live in `src/content/archive/`, one
markdown file each (title, date, tempo, tags, prompt, lyrics). To pull in new
public Suno songs that aren't on a record:

```
npm run import:archive
```

Existing files are never overwritten, so edit freely. Set `hidden: true` to
leave a song out of the library.

To give archive songs (or tracks of unfinished records) their audio, from a
folder of loose files such as downloads from Suno, then run the three sound
data commands above:

```
npm run import:audio -- "/path/to/Unreleased" --dry   # show the matches first
npm run import:audio -- "/path/to/Unreleased"
```

### Remixes and the license

Our music is CC0 (public domain); the license is set once in `src/site.ts`.
Remixes of other people's songs are the exception: mark them `remix: true`
(their pages then say the original's rights apply, and carry no CC0 tag) and
`lyricsHidden: true` (their words aren't ours to print).

## Image placeholders

Covers and gallery images show a blurred colour preview while they load
(BlurHash, decoded at build time into a tiny inline PNG — no JavaScript).
`npm run import` refreshes them; after adding images by hand run:

```
npm run blurhash
```

## News

Posts live in `src/content/news/`, one markdown file each:

```
---
title: "Something happened"
date: 2026-12-01
summary: "One or two sentences for lists, the home page and the RSS feed."
records: ["i-am-your-bug"]   # optional: shown at the end with a play button
draft: true                   # optional: hide it until it's ready
---
The post itself, in markdown.
```

The newest two appear on the home page; all of them on `/news`, in search,
and in the RSS feed at `/rss.xml`.

## Influences (/about)

The list lives in `src/data/influences.ts`. To give an artist a photo, save it
as `public/art/influences/<slug>.webp` (or .jpg/.png), where the slug is the
name in lowercase without accents or punctuation: `vitalic`, `miss-kittin`,
`etienne-de-crecy`, `slagsmalsklubben`… Until then the tile shows initials.
Photos are shown in black and white, in colour on hover. Run `npm run blurhash`
after adding them for the blurred loading preview. Only use photos you have the
rights to.

### Photos from Spotify

Tiles without a photo of your own can use the artist's Spotify picture:

1. Create a free app at https://developer.spotify.com/dashboard and copy its
   Client ID and Client Secret into `web/.env` (git ignores it):

   ```
   SPOTIFY_CLIENT_ID=...
   SPOTIFY_CLIENT_SECRET=...
   ```

2. `npm run influences:spotify` — it prints each match (✓ exact, ≈ guessed).
   For a wrong match, put the right artist id (from its
   `open.spotify.com/artist/<id>` link) as `id` in
   `src/data/influences-spotify.json`, remove its `image`, and run again.

Only image addresses are stored; the pictures load from Spotify, unaltered and
linked to the artist, with a credit under the grid (as Spotify's terms ask).

## Deploy

`dist/` is plain files — any static host works (Netlify, Cloudflare Pages, a
cheap server with nginx). Set `site` in `astro.config.mjs` to the real domain.
