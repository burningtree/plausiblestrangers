// Draws pixel spectrograms (<canvas class="spectro-canvas" data-spec …>) in the
// site's colours. Used by track pages and the library.
export function draw(canvas: HTMLCanvasElement) {
  const cols = Number(canvas.dataset.cols);
  const bands = Number(canvas.dataset.bands);
  // either raw 0–255 values (data-spec, base64) or ready colour steps 0–4
  // (data-steps, two per character: 'a'… = 5 × first + second), as the library's strips use
  const packed = canvas.dataset.steps;
  let bytes: Uint8Array;
  if (packed) {
    bytes = new Uint8Array(packed.length * 2);
    for (let i = 0; i < packed.length; i++) {
      const k = packed.charCodeAt(i) - 97;
      bytes[2 * i] = Math.floor(k / 5);
      bytes[2 * i + 1] = k % 5;
    }
  } else bytes = Uint8Array.from(atob(canvas.dataset.spec || ''), (c) => c.charCodeAt(0));
  const [l1, l2, l3, l4] = (canvas.dataset.levels || '46,92,158,211').split(',').map(Number);
  const cs = getComputedStyle(canvas);
  const ink = cs.getPropertyValue('--ink').trim();
  const hot = cs.getPropertyValue('--hot').trim();
  const faint = cs.getPropertyValue('--faint').trim();
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Show at most one column per ~2 device pixels: narrow canvases average
  // neighbouring columns, wide ones get every column the data has.
  const wave = canvas.closest<HTMLElement>('.wave');
  const shown = Math.max(1, Math.min(cols, Math.floor(canvas.width / (2 * dpr))));
  if (wave) {
    wave.dataset.shown = String(shown);
    snap(wave);
  }
  const value = (sc: number, b: number) => {
    const c0 = Math.floor((sc * cols) / shown);
    const c1 = Math.max(c0 + 1, Math.floor(((sc + 1) * cols) / shown));
    let sum = 0;
    for (let c = c0; c < c1; c++) sum += bytes[c * bands + b];
    return sum / (c1 - c0);
  };

  // cell edges are rounded once and shared by neighbours, so cells always touch
  const xs = Array.from({ length: shown + 1 }, (_, i) => Math.round((i * canvas.width) / shown));
  const ys = Array.from({ length: bands + 1 }, (_, i) => Math.round(canvas.height - (i * canvas.height) / bands));
  for (let c = 0; c < shown; c++)
    for (let b = 0; b < bands; b++) {
      const v = value(c, b);
      // three steps of ink, then the accent for the loudest
      const step = packed ? Math.round(v) : v < l1 ? 0 : v >= l4 ? 4 : v >= l3 ? 3 : v >= l2 ? 2 : 1;
      if (step < 1) continue;
      ctx.fillStyle = step === 4 ? hot : step === 1 ? faint : ink;
      ctx.globalAlpha = step === 2 ? 0.45 : step === 3 ? 0.85 : 1;
      ctx.fillRect(xs[c], ys[b + 1], xs[c + 1] - xs[c], ys[b] - ys[b + 1]);
    }
  ctx.globalAlpha = 1;
}

// Progress snaps to whole columns: a column counts as played as soon as it starts.
// The player sets --p on the .wave; this sets --ps, which the CSS uses instead.
export function snap(wave: HTMLElement) {
  const shown = Number(wave.dataset.shown || 0);
  const p = parseFloat(wave.style.getPropertyValue('--p')) || 0;
  const ps = shown && p > 0 ? `${(Math.min(shown, Math.floor((p / 100) * shown) + 1) / shown) * 100}%` : `${p}%`;
  if (wave.style.getPropertyValue('--ps') !== ps) wave.style.setProperty('--ps', ps);
}
const snapper = new MutationObserver((records) => records.forEach((r) => snap(r.target as HTMLElement)));

const ro = new ResizeObserver((entries) => entries.forEach((e) => draw(e.target as HTMLCanvasElement)));
function setup() {
  document.querySelectorAll<HTMLCanvasElement>('.spectro-canvas').forEach((c) => {
    draw(c);
    ro.observe(c);
    const wave = c.closest<HTMLElement>('.wave');
    if (wave && !wave.dataset.snapping) {
      wave.dataset.snapping = '1';
      snapper.observe(wave, { attributes: true, attributeFilter: ['style'] });
    }
  });
}
// redraw when the theme changes
new MutationObserver(() => document.querySelectorAll<HTMLCanvasElement>('.spectro-canvas').forEach(draw)).observe(
  document.documentElement,
  { attributes: true, attributeFilter: ['data-theme'] },
);
let started = false;
export function initSpectros() {
  if (started) return;
  started = true;
  document.addEventListener('astro:page-load', setup);
  setup();
}
