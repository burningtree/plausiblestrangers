#!/usr/bin/env node
// Blurry placeholders for every cover and gallery image.
//
//   npm run blurhash
//
// For each full-size image in public/covers and public/art it computes a
// BlurHash, then decodes it once into a tiny 12×12 PNG. Pages put that PNG
// behind the real <img> as a background, so a soft colour version shows while
// the image loads — no JavaScript involved.
// Writes src/data/blurhash.json: { "/covers/x.webp": { hash, png } }.
// Re-run after adding images (import-music runs it for you).

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { encode, decode } from 'blurhash';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src/data/blurhash.json');
const SIZE = 32; // sampled at this size for the hash
const PNG_SIZE = 12; // placeholder image size

async function images(dir) {
  const abs = path.join(ROOT, 'public', dir);
  if (!existsSync(abs)) return [];
  const out = [];
  for (const e of await readdir(abs, { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...(await images(rel)));
    // full-size only: the -480/-640 thumbnails share the same picture
    else if (/\.(webp|jpe?g|png)$/i.test(e.name) && !/-(480|640)\.\w+$/.test(e.name) && !/\.jpg$/i.test(e.name))
      out.push(rel);
  }
  return out;
}

const existing = existsSync(OUT) ? JSON.parse(await readFile(OUT, 'utf8')) : {};
const result = {};
for (const rel of [...(await images('covers')), ...(await images('art'))]) {
  const key = `/${rel}`;
  if (existing[key] && !process.argv.includes('--force')) {
    result[key] = existing[key];
    continue;
  }
  const { data, info } = await sharp(path.join(ROOT, 'public', rel))
    .resize(SIZE, SIZE, { fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const hash = encode(new Uint8ClampedArray(data), info.width, info.height, 4, 4);
  // decoded small on purpose: the browser smooths it when stretched, and it
  // keeps each placeholder to a few hundred bytes of inline data
  const pixels = decode(hash, PNG_SIZE, PNG_SIZE);
  const png = await sharp(Buffer.from(pixels), { raw: { width: PNG_SIZE, height: PNG_SIZE, channels: 4 } })
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toBuffer();
  result[key] = { hash, png: `data:image/png;base64,${png.toString('base64')}` };
  console.log(`  ${key}  ${hash}`);
}
await writeFile(OUT, JSON.stringify(result, null, 1));
console.log(`wrote ${path.relative(ROOT, OUT)} (${Object.keys(result).length} images)`);
