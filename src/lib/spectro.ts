// Draws pixel spectrograms (<canvas class="spectro-canvas" data-spec …>) in the
// site's colours. Used by track pages and the library.
export function draw(canvas: HTMLCanvasElement) {
  const cols = Number(canvas.dataset.cols);
  const bands = Number(canvas.dataset.bands);
  const bytes = Uint8Array.from(atob(canvas.dataset.spec || ''), (c) => c.charCodeAt(0));
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
  const shown = Math.max(1, Math.min(cols, Math.floor(canvas.width / (2 * dpr))));
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
      if (v < l1) continue;
      // three steps of ink, then the accent for the loudest
      const step = v >= l4 ? 4 : v >= l3 ? 3 : v >= l2 ? 2 : 1;
      ctx.fillStyle = step === 4 ? hot : step === 1 ? faint : ink;
      ctx.globalAlpha = step === 2 ? 0.45 : step === 3 ? 0.85 : 1;
      ctx.fillRect(xs[c], ys[b + 1], xs[c + 1] - xs[c], ys[b] - ys[b + 1]);
    }
  ctx.globalAlpha = 1;
}

const ro = new ResizeObserver((entries) => entries.forEach((e) => draw(e.target as HTMLCanvasElement)));
function setup() {
  document.querySelectorAll<HTMLCanvasElement>('.spectro-canvas').forEach((c) => {
    draw(c);
    ro.observe(c);
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
