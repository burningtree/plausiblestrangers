// Sheet music in the lyrics column: MusicXML drawn by OpenSheetMusicDisplay (loaded
// only when someone opens the notes), a playhead that follows the player, and a
// tap on any bar to jump there. The page never scrolls by itself; follow mode
// (frame, below) is the opt-in way to keep the playing line in view. Bar times come from scripts/import-scores.mjs.
import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

interface Sheet {
  osmd?: OpenSheetMusicDisplay;
  bars: number[];
  ready: Promise<void>;
  raf: number;
  frameTop?: number; // follow mode: where the window onto the sheet starts
}

const sheets = new WeakMap<HTMLElement, Sheet>();

const UNIT = 10; // OSMD draws 10px per unit at zoom 1

interface Box { left: number; right: number; top: number; bottom: number }

// pixel box of bar i (all staves), relative to the scroll box's content
function barBox(osmd: OpenSheetMusicDisplay, scroller: HTMLElement, i: number): Box | undefined {
  const staves = osmd.GraphicSheet?.MeasureList?.[i]?.filter(Boolean);
  if (!staves?.length) return;
  const svg = scroller.querySelector('svg');
  if (!svg) return;
  const s = svg.getBoundingClientRect();
  const c = scroller.getBoundingClientRect();
  const ox = s.left - c.left + scroller.scrollLeft;
  const oy = s.top - c.top + scroller.scrollTop;
  const k = UNIT * osmd.zoom;
  const first = staves[0].PositionAndShape;
  const last = staves[staves.length - 1].PositionAndShape;
  return {
    left: ox + first.AbsolutePosition.x * k,
    right: ox + (first.AbsolutePosition.x + first.Size.width) * k,
    top: oy + (first.AbsolutePosition.y - 1.5) * k,
    bottom: oy + (last.AbsolutePosition.y + 5.5) * k,
  };
}

const barAt = (bars: number[], t: number) => {
  let i = 0;
  while (i < bars.length - 2 && bars[i + 1] <= t) i++;
  return i;
};

export function openSheet(el: HTMLElement) {
  let sheet = sheets.get(el);
  if (!sheet) {
    sheet = { bars: JSON.parse(el.dataset.bars || '[]'), ready: Promise.resolve(), raf: 0 };
    sheets.set(el, sheet);
    sheet.ready = render(el, sheet);
    listen(el, sheet);
  }
  const s = sheet;
  s.ready.then(() => {
    if (!s.raf) s.raf = requestAnimationFrame(() => follow(el, s));
  });
}

async function render(el: HTMLElement, sheet: Sheet) {
  const status = el.querySelector<HTMLElement>('.sheet-status')!;
  const target = el.querySelector<HTMLElement>('.sheet')!;
  try {
    const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
    const osmd = new OpenSheetMusicDisplay(target, {
      autoResize: true,
      backend: 'svg',
      drawTitle: false,
      drawSubtitle: false,
      drawComposer: false,
      drawLyricist: false,
      drawCredits: false,
      drawPartNames: true,
      drawPartAbbreviations: false,
      drawingParameters: 'compacttight',
    });
    await osmd.load(el.dataset.score!);
    osmd.zoom = el.clientWidth < 560 ? 0.6 : 0.75;
    osmd.render();
    sheet.osmd = osmd;
    status.hidden = true;
  } catch (error) {
    status.textContent = 'the score would not open.';
    console.error(error);
  }
}

function listen(el: HTMLElement, sheet: Sheet) {
  const scroller = el.querySelector<HTMLElement>('.sheet-scroll')!;
  // a tap on a bar: hand the time to the player's [data-seek] handler, which runs after this one
  el.addEventListener('click', (event) => {
    delete el.dataset.seek;
    const osmd = sheet.osmd;
    if (!osmd) return;
    const c = scroller.getBoundingClientRect();
    const x = event.clientX - c.left + scroller.scrollLeft;
    const y = event.clientY - c.top + scroller.scrollTop;
    for (let i = 0; i < sheet.bars.length - 1; i++) {
      const box = barBox(osmd, scroller, i);
      if (!box || x < box.left || x > box.right || y < box.top || y > box.bottom) continue;
      const fraction = (x - box.left) / (box.right - box.left);
      el.dataset.seek = String(sheet.bars[i] + fraction * (sheet.bars[i + 1] - sheet.bars[i]));
      return;
    }
  });
}

function follow(el: HTMLElement, sheet: Sheet) {
  sheet.raf = 0;
  if (!el.isConnected || el.hidden || !sheet.osmd) return; // reopened views start it again
  sheet.raf = requestAnimationFrame(() => follow(el, sheet));

  const ps = (window as any).__ps;
  const head = el.querySelector<HTMLElement>('.sheet-head')!;
  const scroller = el.querySelector<HTMLElement>('.sheet-scroll')!;
  const following = !!el.closest('.lyrics.is-follow');
  if (ps?.current?.()?.id !== el.dataset.seekId) {
    head.hidden = true;
    frame(scroller, sheet, following, barBox(sheet.osmd, scroller, 0));
    return;
  }
  const t: number = ps.time();
  const { bars } = sheet;
  if (t >= bars[bars.length - 1]) {
    head.hidden = true;
    return;
  }
  const i = barAt(bars, t);
  const box = barBox(sheet.osmd, scroller, i);
  if (!box) return;
  frame(scroller, sheet, following, box);
  const fraction = Math.min(1, Math.max(0, (t - bars[i]) / (bars[i + 1] - bars[i])));
  head.hidden = false;
  head.style.transform = `translate(${box.left + fraction * (box.right - box.left)}px, ${box.top}px)`;
  head.style.height = `${box.bottom - box.top}px`;
}

// follow mode: a fixed window onto the sheet (as tall as the lyrics one), the playing
// line of music near its top so the next lines show below; it slides on line by line
function frame(scroller: HTMLElement, sheet: Sheet, following: boolean, box?: Box) {
  if (!following) {
    if (sheet.frameTop !== undefined) {
      sheet.frameTop = undefined;
      scroller.scrollTop = 0;
    }
    return;
  }
  if (!box) return;
  const top = Math.max(0, Math.round(box.top - 32)); // room for the chords and section marks above
  if (sheet.frameTop === top) return;
  const first = sheet.frameTop === undefined;
  sheet.frameTop = top;
  scroller.scrollTo({ top, behavior: first ? 'auto' : 'smooth' });
}
