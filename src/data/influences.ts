// Who inspires us, as shown on /about.
//
// tier 1: the biggest influences (large tiles)
// tier 2: the core top 15 (medium tiles, with a line on what we took from them)
// tier 3: everyone else, strong and occasional influences (small tiles)
// The order below is the order on the page within each tier.
//
// Photos come from Spotify (npm run influences:spotify) unless you put your own
// at public/art/influences/<slug>.(webp|jpg|png) — the slug is the name in
// lowercase without accents or punctuation, or `slug` when given.
export type Influence = {
  name: string;
  tier: 1 | 2 | 3;
  note?: string;
  slug?: string; // for names that don't make a readable URL (e.g. Cyrillic)
  also?: string; // shown after the name, e.g. a transliteration
};

export const influences: Influence[] = [
  // the biggest
  { name: 'Vitalic', tier: 1, note: 'Raw electro, hypnotic repetition, explosive energy' },
  { name: 'Sexy Sushi', tier: 1, note: 'Dirty electroclash, absurdity, punk attitude' },
  { name: 'Fischerspooner', tier: 1, note: 'Theatrical electroclash, synthetic vocals, art-pop' },
  { name: 'The Blaze', tier: 1, note: 'Cinematic atmosphere, emotional depth, gradual builds' },
  { name: 'МЫ', tier: 1, slug: 'my', also: 'My' },

  // the rest of the core top 15
  { name: 'MIDI Lidi', tier: 1, note: 'DIY experimentation, playful electronics, unconventional composition' },
  { name: 'Simian Mobile Disco', tier: 2, note: 'Mechanical grooves, analog synthesis, evolving arrangements' },
  { name: 'Teenage Bad Girl', tier: 2, note: 'Aggressive French electro, distorted bass, controlled chaos' },
  { name: 'Aphex Twin', tier: 2, note: 'Glitch, fractured rhythms, radical sonic experimentation' },
  { name: 'Justice', tier: 2, note: 'Distortion, dramatic dynamics, orchestral electronic power' },
  { name: 'Boys Noize', tier: 2, note: 'Industrial club energy, aggressive synthesis' },
  { name: 'Mr. Oizo', tier: 2, note: 'Absurd minimalism, strange grooves, unpredictable structures' },
  { name: 'Forest Swords', tier: 1, note: 'Ritualistic rhythms, eerie textures, experimental atmosphere' },
  { name: 'Air', tier: 2, note: 'Melodic elegance, dreamy analog electronics' },
  { name: 'Ladytron', tier: 2, note: 'Cold synthpop, robotic vocals, dark melodies' },
  { name: 'SomethingALaMode', tier: 2, note: 'Classical strings colliding with electronic dance music' },

  // major influences
  { name: 'Modeselektor', tier: 2 },
  { name: 'AutoKratz', tier: 2 },
  { name: 'The Chemical Brothers', tier: 2 },
  { name: 'The Knife', tier: 2 },
  { name: 'Gesaffelstein', tier: 2 },
  { name: 'Siriusmo', tier: 2 },
  { name: 'BICEP', tier: 2 },
  { name: 'NTO', tier: 3, also: 'Ntø' },
  { name: 'Giorgio Moroder', tier: 2 },
  { name: 'Kraftwerk', tier: 2 },
  { name: 'French 79', tier: 2 },
  { name: 'The Hacker', tier: 2 },
  { name: 'Moullinex', tier: 2 },
  { name: 'Onuka', tier: 2 },

  // strong influences
  { name: 'ADULT.', tier: 3 },
  { name: 'Miss Kittin', tier: 2 },
  { name: 'Vive La Fête', tier: 3 },
  { name: 'Kap Bambino', tier: 3 },
  { name: 'Tiga', tier: 3 },
  { name: 'Peaches', tier: 3 },
  { name: 'Crystal Castles', tier: 3 },
  { name: 'Röyksopp', tier: 3 },
  { name: 'GusGus', tier: 3 },
  { name: 'Moderat', tier: 3 },
  { name: 'Apparat', tier: 3 },
  { name: 'Lorn', tier: 3 },
  { name: 'Amon Tobin', tier: 3 },
  { name: 'Nicolas Jaar', tier: 3 },
  { name: 'Rone', tier: 3 },
  { name: 'Digitalism', tier: 3 },
  { name: 'SebastiAn', tier: 3 },
  { name: 'Soulwax', tier: 3 },
  { name: 'The Subs', tier: 3 },
  { name: 'Les Petits Pilous', tier: 3 },
  { name: 'Étienne de Crécy', tier: 3 },
  { name: 'Ventolin', tier: 2 },
  { name: 'Monikino Kino', tier: 3 },
  { name: 'DVA', tier: 3 },
  { name: 'Slagsmålsklubben', tier: 3 },
  { name: 'KOMPROMAT', tier: 3 },

  { name: 'WhoMadeWho', tier: 3 },
  { name: 'Daft Punk', tier: 2 },
  { name: 'Golden Bug', tier: 3 },
  { name: 'The Bloody Beetroots', tier: 3 },
  { name: 'Ascii.Disko', tier: 3 },
  { name: 'Hot Chip', tier: 3 },
  { name: 'The Toxic Avenger', tier: 3 },
  { name: 'Scratch Massive', tier: 3 },
  { name: 'Orbital', tier: 3 },
  { name: 'Leftfield', tier: 3 },
  { name: 'Rival Consoles', tier: 3 },
  { name: 'Clark', tier: 3 },
  { name: 'The Bug', tier: 3 },
  { name: 'LCD Soundsystem', tier: 3 },
  { name: 'Arnaud Rebotini', tier: 3 },
  { name: 'Trentemøller', tier: 3, slug: 'trentemoller' },
  { name: 'Fever Ray', tier: 3 },
  { name: 'The Presets', tier: 3 },
  { name: 'The Faint', tier: 3 },
  { name: 'Burial', tier: 3 },
  { name: 'AIGEL', tier: 3 },
  { name: 'Portishead', tier: 3 },

  // secondary / occasional influences
  { name: 'Soldout', tier: 2 },
  { name: 'Depeche Mode', tier: 3 },
  { name: 'Ohm Square', tier: 3 },
  { name: 'Sevdaliza', tier: 3 },
  { name: 'FM Belfast', tier: 3 },
  { name: 'Robots in Disguise', tier: 3 },
  { name: 'Uffie', tier: 3 },
  { name: 'Stereo Total', tier: 3 },
  { name: 'Yelle', tier: 3 },
  { name: 'M.I.A.', tier: 3 },
  { name: 'Does It Offend You, Yeah?', tier: 3 },
  { name: 'Fake Blood', tier: 3 },
  { name: 'Crookers', tier: 3 },
  { name: 'µ-Ziq', tier: 3, slug: 'mu-ziq' },
  { name: 'Felix da Housecat', tier: 3 },
  { name: 'Felix Kubin', tier: 3 },
  { name: 'Brandt Brauer Frick', tier: 3 },
  { name: 'DJ Hell', tier: 3 },
  { name: 'Acid Arab', tier: 3 },

  // more
  { name: 'ZZT', tier: 3 },
  { name: 'Proxy', tier: 3 },
  { name: 'Rex the Dog', tier: 3 },
  { name: 'Djedjotronic', tier: 3 },
  { name: 'Planningtorock', tier: 3 },
  { name: 'Chicks on Speed', tier: 3 },
  { name: 'Shit Robot', tier: 3 },
  { name: 'Daniel Avery', tier: 3 },
  { name: 'The Juan Maclean', tier: 3 },
  { name: 'Zombie Nation', tier: 3 },
  { name: 'Dopplereffekt', tier: 3 },
  { name: 'Legowelt', tier: 3 },
  { name: 'Ellen Allien', tier: 3 },
  { name: 'Ascendant Vierge', tier: 3 },
  { name: 'The Golden Filter', tier: 3 },
  { name: 'DAT Politics', tier: 3 },
  { name: 'MSTRKRFT', tier: 3 },
  { name: 'Huoratron', tier: 3 },
  { name: 'Kormac', tier: 3 },
  { name: 'Casiokids', tier: 3 },
  { name: 'Kazety', tier: 3 },
  { name: 'Moimir Papalescu & The Nihilists', tier: 3 },
  { name: 'Client', tier: 3 },
  { name: 'IAMX', tier: 3 },
  { name: 'Acid Washed', tier: 3 },
  { name: 'Nôze', tier: 3 },
  { name: 'Mumbai Science', tier: 3 },
  { name: 'Danger', tier: 3 },
  { name: 'Don Rimini', tier: 3 },
  { name: 'Yuksek', tier: 3 },
  { name: 'Birdy Nam Nam', tier: 3 },
  { name: 'Weval', tier: 3 },
  { name: 'The Whip', tier: 3 },
  { name: 'Northern Lite', tier: 3 },
  { name: 'Le Tigre', tier: 3 },
  { name: 'The Teenagers', tier: 3 },
  { name: 'Metronomy', tier: 3 },
  { name: 'Cut Copy', tier: 3 },
  { name: 'Breakbot', tier: 3 },
  { name: 'Todd Terje', tier: 3 },
  { name: 'Ecstasy of Saint Theresa', tier: 3 },
  { name: 'Jan P. Muchow', tier: 3 },
];

const toSlug = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/å/gi, 'a')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const slug = (i: Influence | string) =>
  typeof i === 'string' ? toSlug(i) : (i.slug ?? toSlug(i.name));
