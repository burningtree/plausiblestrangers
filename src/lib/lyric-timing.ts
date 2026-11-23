export type LyricCue = { index: number; t: number; e: number };
export type TimedWord = LyricCue & { end: number };
export type TimedLyric = LyricCue & { text: string; words: TimedWord[] };

export type StoredWord = [from: number, to: number, start: number, end: number];
export type StoredLine = [text: string, words: StoredWord[]] | null;

/** Cues are ordered and nonoverlapping. */
export function activeLyric<T extends LyricCue>(cues: readonly T[], time: number): T | undefined {
  for (let i = cues.length - 1; i >= 0; i--) {
    const cue = cues[i];
    if (cue.t <= time) return time < cue.e ? cue : undefined;
  }
}

export function lyricGap(cues: readonly TimedLyric[], time: number, duration: number) {
  const nextIndex = cues.findIndex((cue) => cue.t > time);
  const previous = cues[nextIndex < 0 ? cues.length - 1 : nextIndex - 1];
  const next = cues[nextIndex];
  const start = previous?.e ?? 0;
  const end = next?.t ?? duration;
  if (end - start < 0.6 || time < start || time >= end) return;
  return { previous, next, end };
}

export function hasCompleteWordTiming(text: string, words: readonly TimedWord[]) {
  const tokens = [...text.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)];
  return tokens.length === words.length && tokens.every((token, index) =>
    words[index].index === token.index && words[index].end === token.index + token[0].length,
  );
}

export function lyricSegments(text: string, words: readonly TimedWord[] = []) {
  const segments: { text: string; index?: number; at?: number }[] = [];
  let cursor = 0;
  for (const word of words) {
    if (word.index > cursor) segments.push({ text: text.slice(cursor, word.index) });
    segments.push({ text: text.slice(word.index, word.end), index: word.index, at: word.t });
    cursor = word.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });
  return segments;
}

export function renderLyricLine(element: HTMLElement, line: TimedLyric) {
  element.replaceChildren(...lyricSegments(line.text, line.words).map(({ text, index }) => {
    if (index === undefined) return document.createTextNode(text);
    const word = document.createElement('span');
    word.dataset.word = String(index);
    word.textContent = text;
    return word;
  }));
  delete element.dataset.wordNow;
}

export function highlightLyricWord(element: HTMLElement, word?: TimedWord) {
  const index = word ? String(word.index) : '';
  if (element.dataset.wordNow === index) return;
  element.querySelector('.is-word-now')?.classList.remove('is-word-now');
  if (word) element.querySelector(`[data-word="${index}"]`)?.classList.add('is-word-now');
  element.dataset.wordNow = index;
}
