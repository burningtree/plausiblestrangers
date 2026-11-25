// The "spectrogram / waveform" switch. Any [data-sound-view] box that holds
// [data-view-btn] buttons shows one or the other; the choice is remembered in
// this browser and shared by every page that has the switch.
import { initSeekLines } from './seek-line';

const KEY = 'ps:sound-view';

const stored = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

function apply(view?: string | null) {
  const v = view === 'spectro' ? 'spectro' : 'bars'; // the waveform unless someone chose otherwise
  document.querySelectorAll<HTMLElement>('[data-sound-view]').forEach((box) => {
    if (!box.querySelector('[data-view-btn]')) return; // only one view: nothing to switch
    box.dataset.view = v;
    box.querySelectorAll<HTMLButtonElement>('[data-view-btn]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.viewBtn === v));
    });
  });
}

let started = false;
export function initSoundView() {
  if (started) return;
  started = true;
  initSeekLines();
  document.addEventListener('click', (e) => {
    const btn = (e.target as Element).closest<HTMLButtonElement>('[data-view-btn]');
    if (!btn) return;
    const v = btn.dataset.viewBtn!;
    try {
      localStorage.setItem(KEY, v);
    } catch {}
    apply(v);
  });
  document.addEventListener('astro:page-load', () => apply(stored()));
  apply(stored());
}
