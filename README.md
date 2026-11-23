# plausible strangers. — website

A small static Astro site. No analytics, no cookies, no UI framework.

```
npm install
npm run dev        # http://localhost:4321
npm run build      # static site in dist/
```

## Where things live

| what                          | where                                         |
| ----------------------------- | --------------------------------------------- |
| home page copy                | `src/pages/index.astro`                       |
| links / contact email         | `src/site.ts`                                 |
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

## The archive (/library)

Songs that never made it onto a record live in `src/content/archive/`, one
markdown file each (title, date, tempo, tags, prompt, lyrics). They're info
only: no audio is hosted, each page links to the song on Suno. To pull in new
public Suno songs that aren't on a record:

```
npm run import:archive
```

Existing files are never overwritten, so edit freely. Remixes of other
people's songs get `lyricsHidden: true` (their words aren't ours to print).
Set `hidden: true` to leave a song out of the library.

## Image placeholders

Covers and gallery images show a blurred colour preview while they load
(BlurHash, decoded at build time into a tiny inline PNG — no JavaScript).
`npm run import` refreshes them; after adding images by hand run:

```
npm run blurhash
```

## Deploy

`dist/` is plain files — any static host works (Netlify, Cloudflare Pages, a
cheap server with nginx). Set `site` in `astro.config.mjs` to the real domain.
