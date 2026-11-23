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
    notes: z.string().optional(),
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
    notes: z.string().optional(),
    hidden: z.boolean().default(false),
  }),
});

export const collections = { releases, tracks, archive };
