// Small things you may want to change without touching the pages.
export const site = {
  name: 'plausible strangers.',
  description:
    'Electronic music to dance to, drift off to, and play a little too loud. Hypnotic house, techno and electroclash, with strange voices, misplaced instruments and occasional noise. Human-directed, machine-made.',
  // Shown under "elsewhere / contact". Add more as they exist.
  links: [
    { label: 'suno', href: 'https://suno.com/@plausiblestrangers' },
    { label: 'x / twitter', href: 'https://x.com/plstrangers' },
  ],
  // shown as the site's account when links are shared on X
  twitter: '@plstrangers',
  // Leave empty to hide.
  email: '',
  // The people behind it, shown on /about. `links` are optional.
  people: [
    {
      name: 'Tree',
      role: 'ideas, direction, words, the final say',
      bio: 'Has loved electronic music for as long as they can remember and always wanted to make some, without the training, the instruments or the studio to do it. Now spends evenings listening to a machine try, and deciding which tries are worth keeping.',
      links: [] as { label: string; href: string }[],
    },
  ],
};
