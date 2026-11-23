// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  // Set this to the real domain so social previews get absolute image URLs.
  site: 'https://plausiblestrangers.example',
  devToolbar: { enabled: false },
  prefetch: { prefetchAll: true },
});
