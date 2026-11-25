// Follow mode for the lyrics column: a small window that keeps the current line
// in the middle and glides to the next one as the song plays. (The notes view
// follows in sheet.ts, which reads the same .is-follow class.)
const KEY = 'ps-follow';
const loops = new WeakMap<HTMLElement, number>();

export function restoreFollow() {
  let on = false;
  try {
    on = localStorage.getItem(KEY) === '1';
  } catch {}
  document.querySelectorAll<HTMLElement>('.lyrics').forEach((lyrics) => {
    if (lyrics.querySelector('[data-lyrics-follow]')) setFollow(lyrics, on, false);
  });
}

export function setFollow(lyrics: HTMLElement, on: boolean, remember: boolean) {
  lyrics.classList.toggle('is-follow', on);
  lyrics.querySelector('[data-lyrics-follow]')?.setAttribute('aria-pressed', String(on));
  if (remember) {
    try {
      localStorage.setItem(KEY, on ? '1' : '0');
    } catch {}
  }
  const copy = lyrics.querySelector<HTMLElement>('.lyrics-copy');
  if (!copy) return;
  if (!on) {
    copy.scrollTop = 0;
    return;
  }
  if (!loops.has(lyrics)) follow(lyrics, copy, undefined);
}

// the line to keep in the middle: the one being sung, else the next one to come
function target(lyrics: HTMLElement, copy: HTMLElement) {
  if (!lyrics.classList.contains('is-current-track')) return undefined;
  return copy.querySelector<HTMLElement>('.ly.is-now') ?? copy.querySelector<HTMLElement>('.ly:not(.is-past)') ?? undefined;
}

function follow(lyrics: HTMLElement, copy: HTMLElement, last: HTMLElement | undefined | null) {
  if (!lyrics.isConnected || !lyrics.classList.contains('is-follow')) {
    loops.delete(lyrics);
    return;
  }
  const current = copy.hidden ? last : (target(lyrics, copy) ?? null);
  loops.set(lyrics, requestAnimationFrame(() => follow(lyrics, copy, current)));
  if (current === last) return;
  const top = current ? current.offsetTop + current.offsetHeight / 2 - copy.clientHeight / 2 : 0;
  copy.scrollTo({ top: Math.max(0, top), behavior: last === undefined ? 'auto' : 'smooth' });
}
