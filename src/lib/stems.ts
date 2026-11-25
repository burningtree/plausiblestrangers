// A song's stems under its waveform: each part can be turned off or soloed while
// the song plays. The site player's mix stays the clock (seeking, lyrics and the
// playhead keep working as always); the parts are plain <audio> elements that
// follow it, routed through Web Audio:
//
//   part <audio> → part gain (on/off, faded) ┐
//   part <audio> → part gain                 ├→ stems bus → limiter → speakers
//   …                                        ┘
//
// The first time, while the parts load and get in step, the mix keeps playing;
// once every part is within a few ms of it, the two crossfade. After that a seek
// or a pause doesn't bring the mix back (you'd hear the muted parts): it goes
// quiet for the moment the parts need to land at the new spot. Muting and soloing are short gain fades, never hard switches
// (those click). Small drift is pulled back with tiny speed changes (at most
// 0.3%, below what you can hear); anything bigger hands back to the mix and
// re-syncs instead of being heard.
import { mixGraph } from './mix-graph';
import { activeBooth } from './booth/audio';

interface Part {
  name: string;
  src: string;
  lane: HTMLElement;
  on: boolean;
  solo: boolean;
  el?: HTMLAudioElement;
  node?: MediaElementAudioSourceNode;
  gain?: GainNode;
  drift?: number; // smoothed: currentTime is reported in coarse steps
}
interface Stems {
  root: HTMLElement;
  id: string;
  parts: Part[];
  timer: number;
  live: boolean; // the parts are what you hear (the mix is faded out)
  steady: number; // ticks in a row with every part in step
  ready: boolean; // the parts have played in step once: from now on, never cover with the mix
  bus?: GainNode;
  limiter?: DynamicsCompressorNode;
}

const TICK = 50; // ms
const LEAD = 0.03; // a seek takes a moment to land: aim a little ahead
const IN_STEP = 0.012; // s: close enough to take over from the mix
const LOST = 0.07; // s: too far to pull back gently → hand back to the mix, re-sync
const FADE = 0.012; // s: time constant of every gain change

const all = new WeakMap<HTMLElement, Stems>();
let active: Stems | undefined;
let started = false;

const audible = (s: Stems, p: Part) => (s.parts.some((q) => q.solo) ? p.solo : p.on);
const engaged = (s: Stems) => s.parts.some((p) => !audible(s, p));
const native = () => document.getElementById('ps-audio') as HTMLAudioElement | null;
const volumeOf = (a: HTMLAudioElement) => (a.muted ? 0 : a.volume);

function stemsOf(root: HTMLElement): Stems {
  let s = all.get(root);
  if (!s) {
    s = {
      root,
      id: root.dataset.stems!,
      parts: [...root.querySelectorAll<HTMLElement>('.stem')].map((lane) => ({
        name: lane.dataset.stem!,
        src: lane.dataset.src!,
        lane,
        on: true,
        solo: false,
      })),
      timer: 0,
      live: false,
      steady: 0,
      ready: false,
    };
    all.set(root, s);
    if (import.meta.env.DEV) (window as any).__stems = s; // to inspect timing while developing
  }
  return s;
}

function ramp(param: AudioParam, to: number, tc = FADE) {
  const { actx } = mixGraph();
  param.cancelScheduledValues(actx.currentTime);
  param.setTargetAtTime(to, actx.currentTime, tc);
}

// the stems' own little graph, made the first time they are needed
function build(s: Stems) {
  if (s.bus) return;
  const { actx } = mixGraph();
  s.bus = actx.createGain();
  s.bus.gain.value = 0;
  // the parts were never mastered together: summed, their peaks go over full scale
  s.limiter = actx.createDynamicsCompressor();
  s.limiter.threshold.value = -2;
  s.limiter.knee.value = 0;
  s.limiter.ratio.value = 20;
  s.limiter.attack.value = 0.001;
  s.limiter.release.value = 0.12;
  s.bus.connect(s.limiter).connect(actx.destination);
  for (const p of s.parts) {
    const el = new Audio();
    el.crossOrigin = 'anonymous'; // the parts come from the download server: Web Audio needs CORS to hear them
    el.src = p.src;
    el.preload = 'auto';
    (el as any).preservesPitch = false; // a speed nudge is then a clean, tiny pitch change, not a warble
    p.el = el;
    p.node = actx.createMediaElementSource(el);
    p.gain = actx.createGain();
    p.gain.gain.value = audible(s, p) ? 1 : 0;
    p.node.connect(p.gain).connect(s.bus);
  }
}

// hand the sound to the parts, or back to the mix
function setLive(s: Stems, live: boolean, quick = false, cover = !s.ready) {
  if (s.live === live) return;
  s.live = live;
  if (live) s.ready = true;
  const a = native();
  ramp(mixGraph().mix.gain, live || !cover ? 0 : 1, quick ? 0.004 : 0.02);
  if (s.bus) ramp(s.bus.gain, live && a ? volumeOf(a) : 0, quick ? 0.004 : 0.02);
  paint(s);
}

// lose the step (a seek, a pause): go quiet at once, send every part to the
// player's new moment straight away, and fade back in once they are all there
function resync(s: Stems) {
  setLive(s, false, true);
  s.steady = 0;
  const a = native();
  for (const p of s.parts) {
    p.drift = undefined;
    if (!p.el) continue;
    if (!p.el.paused) p.el.pause();
    if (a) p.el.currentTime = a.currentTime + LEAD;
  }
}

function paint(s: Stems) {
  const soloing = s.parts.some((p) => p.solo);
  for (const p of s.parts) {
    p.lane.classList.toggle('is-off', !audible(s, p));
    p.lane.classList.toggle('is-solo', p.solo);
    p.lane.querySelector('.stem-name')!.setAttribute('aria-pressed', String(audible(s, p)));
    p.lane.querySelector('.stem-solo')!.setAttribute('aria-pressed', String(p.solo));
  }
  const reset = s.root.querySelector<HTMLElement>('[data-stems-reset]');
  if (reset) reset.hidden = !engaged(s);
  const status = s.root.querySelector<HTMLElement>('[data-stems-status]');
  if (!status) return;
  const on = s.parts.filter((p) => audible(s, p)).map((p) => p.name);
  const a = native();
  status.textContent = !engaged(s)
    ? 'turn parts off, or solo one, while it plays.'
    : !on.length
      ? 'every part is off.'
      : s.live || !a || a.paused
        ? `${soloing ? 'only' : 'playing'}: ${on.join(', ')}`
        : 'getting the parts in step…';
}

// follow the mix: same moment, same play/pause, same volume
function tick(s: Stems) {
  const a = native();
  const ps = (window as any).__ps;
  const mine = !!a && !activeBooth() && ps?.current?.()?.id === s.id;
  if (!s.root.isConnected || !engaged(s) || !mine) {
    release(s, !s.root.isConnected);
    return;
  }
  build(s);
  active = s;
  const playing = !a!.paused && !a!.seeking;
  if (!playing) {
    if (s.live || s.parts.some((p) => !p.el!.paused)) resync(s);
    return;
  }
  if (s.live) ramp(s.bus!.gain, volumeOf(a!), 0.05); // follow the player's volume
  const t = a!.currentTime;
  let inStep = true;
  for (const p of s.parts) {
    const el = p.el!;
    if (el.paused || el.seeking) {
      if (!el.seeking) {
        if (Math.abs(el.currentTime - t - LEAD) > 0.1) el.currentTime = t + LEAD;
        el.play().catch(() => {});
      }
      inStep = false;
      continue;
    }
    if (el.readyState < 3) inStep = false;
    const raw = el.currentTime - t;
    if (Math.abs(raw) > (s.live ? LOST : 0.25)) {
      // lost: if this is heard, the mix covers while every part re-syncs
      if (s.live) return resync(s);
      el.currentTime = t + LEAD;
      p.drift = undefined;
      inStep = false;
      continue;
    }
    const drift = (p.drift = p.drift === undefined ? raw : p.drift * 0.7 + raw * 0.3);
    // unheard (getting in step) it may hurry; heard, only by an inaudible 0.3%
    const most = s.live ? 0.003 : 0.05;
    el.playbackRate = 1 - Math.max(-most, Math.min(most, drift * (s.live ? 0.6 : 2)));
    if (Math.abs(drift) > IN_STEP) inStep = false;
  }
  s.steady = inStep ? s.steady + 1 : 0;
  if (!s.live && s.steady >= 3) setLive(s, true);
}

function engage(s: Stems) {
  const { actx } = mixGraph();
  actx.resume().catch(() => {});
  if (active && active !== s) release(active, true);
  active = s;
  if (!s.timer) s.timer = window.setInterval(() => tick(s), TICK);
  tick(s);
}

// back to the mix; `forget` also drops the parts (the page is gone)
function release(s: Stems, forget = false) {
  if (s.timer) {
    clearInterval(s.timer);
    s.timer = 0;
  }
  setLive(s, false, false, true);
  ramp(mixGraph().mix.gain, 1, 0.02); // even if it was quiet between a seek and the parts landing
  if (s.bus) ramp(s.bus.gain, 0, 0.02);
  s.steady = 0;
  s.ready = false;
  for (const p of s.parts) {
    if (!p.el) continue;
    const el = p.el;
    window.setTimeout(() => el.pause(), 120); // after the fade
    if (forget) {
      p.node?.disconnect();
      p.gain?.disconnect();
      window.setTimeout(() => {
        el.removeAttribute('src');
        el.load();
      }, 150);
      p.el = p.node = p.gain = undefined;
      p.drift = undefined;
    }
  }
  if (forget) {
    s.limiter?.disconnect();
    s.bus?.disconnect();
    s.bus = s.limiter = undefined;
    if (active === s) active = undefined;
  }
  if (s.root.isConnected) paint(s);
}

export function initStems() {
  if (started) return;
  started = true;
  // the player jumps or stops: don't let the parts play on at the old moment
  const a = native();
  for (const type of ['seeking', 'pause']) {
    a?.addEventListener(type, () => {
      if (active?.timer) resync(active);
    });
  }
  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const toggle = event.target.closest<HTMLButtonElement>('[data-stems-toggle]');
    if (toggle) {
      const root = document.getElementById(toggle.getAttribute('aria-controls')!);
      if (!root) return;
      const open = root.hidden;
      root.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      root.closest('.sound-view')?.classList.toggle('is-stems', open);
      return;
    }
    const root = event.target.closest<HTMLElement>('[data-stems]');
    if (!root) return;
    const s = stemsOf(root);
    const lane = event.target.closest<HTMLElement>('.stem');
    const part = s.parts.find((p) => p.lane === lane);
    if (event.target.closest('.stem-name') && part) {
      if (s.parts.some((p) => p.solo)) {
        // while soloing, a name adds or removes that part from what you hear
        part.solo = !part.solo;
      } else part.on = !part.on;
    } else if (event.target.closest('.stem-solo') && part) {
      part.solo = !part.solo;
    } else if (event.target.closest('[data-stems-reset]')) {
      for (const p of s.parts) {
        p.on = true;
        p.solo = false;
      }
    } else return;
    for (const p of s.parts) if (p.gain) ramp(p.gain.gain, audible(s, p) ? 1 : 0);
    paint(s);
    if (engaged(s)) engage(s);
    else release(s);
  });
  // leaving the page: hand the sound back to the mix
  document.addEventListener('astro:before-swap', () => {
    document.querySelectorAll<HTMLElement>('[data-stems]').forEach((root) => {
      const s = all.get(root);
      if (s) release(s, true);
    });
  });
}
