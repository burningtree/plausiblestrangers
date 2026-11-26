// Where a record or a song can be heard besides here: the streaming stores
// (links in its frontmatter), DistroKid's page of all of them, and Suno.
export interface Listen {
  name: string;
  /** what it is, in a few words */
  note: string;
  href: string;
}

interface Links {
  spotify?: string;
  appleMusic?: string;
  deezer?: string;
  hyperfollow?: string;
  suno?: string;
}

export function listenLinks(d: Links, more?: Links): Listen[] {
  const all = { ...more, ...d };
  return [
    all.spotify && { name: 'spotify', note: 'stream', href: all.spotify },
    all.appleMusic && { name: 'apple music', note: 'stream · buy', href: all.appleMusic },
    all.deezer && { name: 'deezer', note: 'stream', href: all.deezer },
    all.hyperfollow && { name: 'all stores', note: 'tidal, youtube, amazon…', href: all.hyperfollow },
    all.suno && { name: 'suno', note: 'where it was made', href: all.suno },
  ].filter((l): l is Listen => !!l);
}

/** only the stores, without Suno: is it out there at all? */
export const inStores = (d: Links) => !!(d.spotify || d.appleMusic || d.deezer || d.hyperfollow);
