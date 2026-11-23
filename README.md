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

## Deploy

`dist/` is plain files — any static host works (Netlify, Cloudflare Pages, a
cheap server with nginx). Set `site` in `astro.config.mjs` to the real domain.
