// A vertical line that follows the pointer over a spectrogram or bar waveform,
// with the time a click would jump to. (Clicking itself is the player's job:
// any .wave[data-wave] seeks.) Also adds the playhead line to bar waveforms;
// the spectrogram draws its own in CSS.
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function attach(el: HTMLElement) {
  if (el.dataset.seekLine) return;
  el.dataset.seekLine = '1';
  const mini = el.classList.contains('wave--bars-mini') || el.classList.contains('spectro--mini');
  const line = document.createElement('span');
  line.className = 'seek-hover';
  line.setAttribute('aria-hidden', 'true');
  const time = document.createElement('span');
  time.className = 'seek-time';
  if (!mini) line.append(time);
  el.append(line);
  if (el.classList.contains('wave--bars')) {
    const head = document.createElement('span');
    head.className = 'seek-head';
    head.setAttribute('aria-hidden', 'true');
    el.append(head);
  }
  el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    el.style.setProperty('--hx', `${f * 100}%`);
    el.classList.add('is-hovering');
    const d = Number(el.dataset.duration || 0);
    if (!mini && d) time.textContent = fmt(f * d);
  });
  el.addEventListener('pointerleave', () => el.classList.remove('is-hovering'));
}

function setup() {
  document.querySelectorAll<HTMLElement>('.wave--bars, .wave.spectro').forEach(attach);
}

let started = false;
export function initSeekLines() {
  if (started) return;
  started = true;
  document.addEventListener('astro:page-load', setup);
  setup();
}
