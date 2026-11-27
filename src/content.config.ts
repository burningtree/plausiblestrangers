import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// One markdown file per record. The body is optional liner notes.
const releases = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/releases' }),
  schema: z.object({
    title: z.string(),
    kind: z.string().default('EP'),
    catalog: z.string(),
    date: z.coerce.date().optional(),
    cover: z.string().optional(),
    backCover: z.string().optional(),
    vinylLabel: z.object({
      x: z.number().min(0).max(100),
      y: z.number().min(0).max(100),
      zoom: z.number().min(100),
    }).optional(),
    suno: z.string().url().optional(),
    ace: z.string().url().optional(),
    // out in the streaming stores (DistroKid): the label it went out under, its
    // barcode, the day it came out there, and where to hear it
    label: z.string().optional(),
    upc: z.string().regex(/^\d{12,13}$/).optional(),
    storeDate: z.coerce.date().optional(),
    spotify: z.string().url().optional(),
    appleMusic: z.string().url().optional(),
    deezer: z.string().url().optional(),
    hyperfollow: z.string().url().optional(),
    // 'unfinished' records show up with a stamp, after the released ones
    status: z.enum(['released', 'unfinished']).default('released'),
    hidden: z.boolean().default(false),
    // extra images shown on the record page (concept art, outtakes…).
    // src is the full image; a "-640" version next to it is used as the thumbnail if present.
    gallery: z
      .array(z.object({ src: z.string(), alt: z.string(), caption: z.string().optional() }))
      .default([]),
  }),
});

// One markdown file per track. The body is the lyrics, as plain text:
// lines in [square brackets] are stage directions to the machine.
const tracks = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/tracks' }),
  schema: z.object({
    title: z.string(),
    release: z.string(),
    number: z.number(),
    audio: z.string().optional(), // no audio yet → page shows words only
    duration: z.number(),
    bpm: z.number().optional(),
    key: z.string().optional(),
    instrumental: z.boolean().default(false),
    created: z.coerce.date().optional(),
    machine: z.string().optional(),
    tags: z.string().optional(),
    style: z.string().optional(),
    suno: z.string().url().optional(),
    ace: z.string().url().optional(),
    notes: z.string().optional(),
    // the recording's code in the stores
    isrc: z.string().regex(/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/).optional(),
    // the song in the streaming stores
    spotify: z.string().url().optional(),
    appleMusic: z.string().url().optional(),
    deezer: z.string().url().optional(),
  }),
});

// Songs that never made it onto a record (scripts/import-archive.mjs).
// Info only: no audio is hosted, each links to the song on Suno.
const archive = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/archive' }),
  schema: z.object({
    title: z.string(),
    created: z.coerce.date().optional(),
    duration: z.number().optional(),
    audio: z.string().optional(),
    bpm: z.number().optional(),
    instrumental: z.boolean().default(false),
    lyricsHidden: z.boolean().default(false),
    remix: z.boolean().default(false),
    tags: z.string().optional(),
    style: z.string().optional(),
    machine: z.string().optional(),
    suno: z.string().url().optional(),
    ace: z.string().url().optional(),
    heartmula: z.string().url().optional(),
    // made on a free plan that only allows personal use: not ours to give away, so not CC0
    personalUse: z.boolean().default(false),
    notes: z.string().optional(),
    hidden: z.boolean().default(false),
  }),
});

// News: short posts, newest first. The body is markdown.
const news = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/news' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    // one or two sentences for lists, the home page and the RSS feed
    summary: z.string().optional(),
    // records this post is about: shown at the end with a play button
    records: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

export const collections = { releases, tracks, archive, news };
