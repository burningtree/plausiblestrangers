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
    suno: z.string().url().optional(),
    // 'unfinished' records show up with a stamp, after the released ones
    status: z.enum(['released', 'unfinished']).default('released'),
    hidden: z.boolean().default(false),
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

export const collections = { releases, tracks };
