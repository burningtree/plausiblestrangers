// @ts-check
import { defineConfig } from 'astro/config';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, normalize, extname } from 'node:path';

// While developing, the downloads (MP3s, stems: files/, see scripts/files.mjs)
// are served at /_files, the way public.plausiblestrangers.com serves them for real:
// with byte ranges (seeking in the stems needs them) and open CORS.
const FILES = new URL('./files/', import.meta.url).pathname;
const TYPES = { '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.zip': 'application/zip', '.wav': 'audio/wav' };
/** @type {import('vite').Plugin} */
const devFiles = {
  name: 'dev-files',
  configureServer(server) {
    server.middlewares.use('/_files', (req, res, next) => {
      const path = normalize(join(FILES, decodeURIComponent((req.url ?? '').split('?')[0])));
      if (!path.startsWith(FILES) || !existsSync(path) || !statSync(path).isFile()) return next();
      const size = statSync(path).size;
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Type', TYPES[extname(path)] ?? 'application/octet-stream');
      const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
      if (range) {
        const start = range[1] ? Number(range[1]) : size - Number(range[2]);
        const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
        res.statusCode = 206;
        res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
        res.setHeader('Content-Length', end - start + 1);
        createReadStream(path, { start, end }).pipe(res);
      } else {
        res.setHeader('Content-Length', size);
        createReadStream(path).pipe(res);
      }
    });
  },
};

// https://astro.build/config
export default defineConfig({
  // The real domain: used for absolute URLs in social previews.
  // (GitHub Pages serves it via public/CNAME.)
  site: 'https://plausiblestrangers.com',
  devToolbar: { enabled: false },
  prefetch: { prefetchAll: true },
  vite: { plugins: [devFiles] },
});
