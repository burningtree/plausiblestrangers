// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  // The real domain: used for absolute URLs in social previews.
  // (GitHub Pages serves it via public/CNAME.)
  site: 'https://plausiblestrangers.com',
  devToolbar: { enabled: false },
  prefetch: { prefetchAll: true },
});
