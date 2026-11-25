// Small things you may want to change without touching the pages.
export const site = {
  name: 'plausible strangers.',
  description:
    'Electronic music to dance to, drift off to, and play a little too loud. Hypnotic house, techno and electroclash, with strange voices, misplaced instruments and occasional noise. Human-directed, machine-made.',
  // Shown under "elsewhere / contact". Add more as they exist.
  links: [
    { label: 'suno', href: 'https://suno.com/@plausiblestrangers' },
    { label: 'x / twitter', href: 'https://x.com/plstrangers' },
    { label: 'github', href: 'https://github.com/burningtree/plausiblestrangers' },
  ],
  // Our music is free: CC0, no rights reserved (except remixes of other people's songs).
  license: {
    name: 'CC0 1.0',
    title: 'Creative Commons CC0 1.0 Universal (public domain dedication)',
    url: 'https://creativecommons.org/publicdomain/zero/1.0/',
  },
  // shown as the site's account when links are shared on X
  twitter: '@plstrangers',
  // Leave empty to hide.
  email: '',
  // The people behind it, shown on /about. `links` are optional.
  people: [
    {
      name: 'Tree',
      role: 'ideas, direction, words, the final say',
      location: 'Czech Republic',
      // a photo in public/art/people/, e.g. '/art/people/tree.webp'
      photo: '/art/people/tree.webp' as string | undefined,
      bio: "I've loved electronic music for as long as I can remember: French electro and electroclash, Czech oddballs like MIDI Lidi, anything that makes a dancefloor feel slightly wrong in a good way. I always wanted to make my own, but never had the training, the instruments or the studio. Now I spend my evenings with a machine that plays everything I can't. I bring the ideas and the words, listen to a lot of tries, and keep the few that feel like they should exist.",
      links: [] as { label: string; href: string }[],
    },
  ],
};
