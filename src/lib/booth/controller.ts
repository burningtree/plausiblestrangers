import { activeBooth, boothAudio, channelControls, effects, type BoothRelease, type BoothTrack, type ChannelControl, type Side, type WaveformScope } from './audio';
import type { createBoothScene } from './scene';

const sides = [0, 1] as const;
const format = (time: number) => `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}`;
type PlayerBridge = { native: () => { item?: { id: string }; time: number } };

export class BoothElement extends HTMLElement {
  private listeners?: AbortController;

  connectedCallback() {
    if (this.listeners) return;
    const catalog = this.querySelector<HTMLScriptElement>('[data-booth-catalog]');
    if (!catalog) return;
    const { crate, library }: { crate: BoothRelease[]; library: BoothTrack[] } = JSON.parse(catalog.textContent || '{}');
    if (!library?.length) return;
    const engine = boothAudio();
    engine.library = library;
    const listeners = this.listeners = new AbortController();
    const { signal } = listeners;
    const find = <E extends HTMLElement>(selector: string) => this.querySelector<E>(selector)!;
    const getBridge = () => (window as Window & { __ps?: PlayerBridge }).__ps?.native();
    const stage = find('[data-stage]');
    const dialog = find<HTMLDialogElement>('#booth-controls');
    find('[data-open-controls]').addEventListener('click', () => dialog.showModal(), { signal });
    const status = find('[data-status]');
    const cards = this.querySelectorAll<HTMLElement>('[data-record-album]');
    const panels = sides.map(i => find<HTMLElement>(`[data-side="${i}"]`));
    const values = panels.map(panel => ({
      album: panel.querySelector<HTMLSelectElement>('[data-album]')!,
      track: panel.querySelector<HTMLSelectElement>('[data-track]')!,
      seek: panel.querySelector<HTMLInputElement>('[data-position]')!,
      waveform: panel.querySelector<HTMLSelectElement>('[data-waveform-scope]')!,
      pitch: panel.querySelector<HTMLInputElement>('[data-pitch]')!,
      pitchRead: panel.querySelector<HTMLOutputElement>('[data-pitch-read]')!,
      readout: panel.querySelector<HTMLElement>('[data-deck-state]')!,
      time: panel.querySelector<HTMLElement>('[data-time]')!,
      effect: panel.querySelector<HTMLSelectElement>('[data-effect]')!,
      buttons: Object.fromEntries(Array.from(panel.querySelectorAll<HTMLButtonElement>('[data-action]'), button => [button.dataset.action, button])),
      channel: panel.querySelectorAll<HTMLInputElement>('[data-channel]'),
      hot: Array.from(panel.querySelectorAll<HTMLButtonElement>('[data-hot]')),
      beats: Array.from(panel.querySelectorAll<HTMLButtonElement>('[data-beats]')),
      filter: panel.querySelector<HTMLInputElement>('[data-filter]')!,
      filterRead: panel.querySelector<HTMLOutputElement>('[data-filter-read]')!,
    }));
    const params = new URLSearchParams(location.search);
    const linked = library.find(track => track.id === params.get('track')) ?? library.find(track => track.album === params.get('release'));
    const native = getBridge();
    const nativeTrack = !activeBooth() && native?.item && library.find(track => track.id === native.item?.id);
    const picks = [
      linked || engine.decks[0].track || nativeTrack || library[0],
      engine.decks[1].track || library.find(track => track.album !== (linked || library[0]).album) || library[0],
    ];
    const monitors = find<HTMLButtonElement>('[data-headphones]');
    const output = find<HTMLSelectElement>('[data-output]');
    const outputHint = find('[data-output-hint]');
    const record = find<HTMLButtonElement>('[data-record]');
    const mix = this.querySelectorAll<HTMLInputElement>('[data-mix]');
    monitors.hidden = !engine.canMonitor;
    record.hidden = typeof MediaRecorder === 'undefined';

    function listTracks(side: Side, album: string, trackId?: string) {
      const entry = values[side];
      entry.album.value = album;
      entry.track.replaceChildren(...library.filter(item => item.album === album).map(item => new Option(item.title, item.id)));
      if (trackId) entry.track.value = trackId;
    }
    sides.forEach(side => listTracks(side, picks[side].album, picks[side].id));

    const trackById = new Map(library.map(track => [track.id, track]));
    const selected = (side: Side) => trackById.get(values[side].track.value);
    const observedTracks = engine.decks.map(deck => deck.track?.id);

    function load(side: Side, track: BoothTrack, play = false, focus = true) {
      listTracks(side, track.album, track.id);
      const site = getBridge();
      const transfer = side === 0 && !activeBooth() && site?.item?.id === track.id;
      const time = transfer ? () => getBridge()?.item?.id === track.id ? getBridge()?.time ?? 0 : 0 : 0;
      status.textContent = '';
      void engine.load(side, track, { start: time, play, focus });
    }

    function toggle(side: Side) {
      const deck = engine.decks[side];
      const track = selected(side);
      if (!track || deck.loading) return;
      const site = getBridge();
      if (side === 0 && !activeBooth() && site?.item?.id === track.id) {
        load(side, track, true);
        return;
      }
      if (!deck.track || deck.error || deck.track.id !== track.id) load(side, track, true);
      else engine.setPlaying(side, !deck.playing);
    }

    function trackNeighbor(side: Side, direction: -1 | 1) {
      const deck = engine.decks[side];
      if (!deck.loading) return engine.neighbor(side, direction, deck.track ?? selected(side));
    }

    function step(side: Side, direction: -1 | 1) {
      const track = trackNeighbor(side, direction);
      if (track) load(side, track, engine.decks[side].playing, false);
    }

    const canStep = (side: Side, direction: -1 | 1) =>
      !values[side].buttons[direction === -1 ? 'previous' : 'next'].disabled;

    function loadAlbum(side: Side, album: string) {
      const track = library.find(item => item.album === album);
      if (track) load(side, track);
    }

    async function assignMonitor(id?: string, side?: Side) {
      try {
        await engine.selectMonitor(id);
        monitors.textContent = 'Change headphone output';
        outputHint.hidden = false;
        outputHint.textContent = 'Headphone cue is routed to the selected device.';
        if (side !== undefined) engine.toggleMonitor(side);
      } catch (error) {
        const devices = await engine.outputs().catch(() => []);
        output.replaceChildren(new Option('Select separate output…', ''), ...devices.map((device, index) => new Option(device.label || `Output ${index + 1}`, device.deviceId)));
        output.hidden = !devices.length;
        outputHint.hidden = false;
        outputHint.textContent = devices.length ? 'Choose a separate headphone output.' : (error instanceof Error ? error.message : 'A separate output is unavailable.');
      }
    }

    function monitor(side: Side) {
      if (!engine.toggleMonitor(side)) void assignMonitor(output.value || undefined, side);
    }
    monitors.addEventListener('click', () => void assignMonitor(), { signal });
    output.addEventListener('change', () => { if (output.value) void assignMonitor(output.value); }, { signal });

    function recordMix() {
      if (typeof MediaRecorder === 'undefined') return;
      void engine.record(blob => {
        if (!blob.size) return;
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const extension = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
        link.download = `plausible-strangers-mix-${new Date().toISOString().slice(0, 10)}.${extension}`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      }).catch(() => { status.textContent = 'Mix recording is unavailable in this browser.'; });
    }
    record.addEventListener('click', recordMix, { signal });

    const scratch = (side: Side, rate: number) => engine.scratch(side, rate, 330);
    for (const side of sides) {
      const entry = values[side];
      const deck = engine.decks[side];
      entry.album.addEventListener('change', () => loadAlbum(side, entry.album.value), { signal });
      entry.track.addEventListener('change', () => { const track = selected(side); if (track) load(side, track); }, { signal });
      entry.waveform.addEventListener('change', () => engine.setWaveformScope(side, entry.waveform.value as WaveformScope), { signal });
      entry.seek.addEventListener('input', () => {
        entry.seek.setAttribute('aria-valuetext', `${format(Number(entry.seek.value))} / ${format(Number(entry.seek.max))}`);
      }, { signal });
      entry.seek.addEventListener('change', () => engine.seekRecord(side, Number(entry.seek.value), selected(side)), { signal });
      entry.pitch.addEventListener('input', () => engine.setPitch(side, Number(entry.pitch.value)), { signal });
      entry.effect.addEventListener('change', () => engine.setEffect(side, Number(entry.effect.value)), { signal });
      for (const input of entry.channel) input.addEventListener('input', () => engine.setChannel(side, input.dataset.channel as ChannelControl, Number(input.value)), { signal });
      entry.buttons.play.addEventListener('click', () => toggle(side), { signal });
      entry.buttons.previous.addEventListener('click', () => step(side, -1), { signal });
      entry.buttons.next.addEventListener('click', () => step(side, 1), { signal });
      entry.buttons.rpm.addEventListener('click', () => engine.toggleRpm(side), { signal });
      entry.buttons.cue.addEventListener('click', () => engine.cue(side), { signal });
      entry.buttons.store.addEventListener('click', () => engine.setCue(side), { signal });
      entry.buttons.in.addEventListener('click', () => engine.markLoop(side, 'in'), { signal });
      entry.buttons.out.addEventListener('click', () => engine.markLoop(side, 'out'), { signal });
      entry.buttons.loop.addEventListener('click', () => engine.toggleLoop(side), { signal });
      entry.buttons.reverse.addEventListener('click', () => scratch(side, -2.2), { signal });
      entry.buttons.forward.addEventListener('click', () => scratch(side, 2.2), { signal });
      entry.buttons.sync.addEventListener('click', () => engine.sync(side), { signal });
      entry.hot.forEach((button, pad) => button.addEventListener('click', event => {
        const deck = engine.decks[side];
        if (event.shiftKey) engine.clearHotCue(side, pad);
        else if (deck.track && !deck.loading) engine.hotCue(side, pad);
      }, { signal }));
      entry.beats.forEach(button => button.addEventListener('click', () => engine.beatLoop(side, Number(button.dataset.beats)), { signal }));
      entry.filter.addEventListener('input', () => engine.setFilter(side, Number(entry.filter.value)), { signal });
      entry.buttons.monitor.hidden = !engine.canMonitor;
      entry.buttons.monitor.addEventListener('click', () => monitor(side), { signal });
      panels[side].addEventListener('dragover', event => {
        if (event.dataTransfer?.types.includes('application/x-ps-record')) event.preventDefault();
      }, { signal });
      panels[side].addEventListener('drop', event => {
        const album = event.dataTransfer?.getData('application/x-ps-record');
        if (album) { event.preventDefault(); loadAlbum(side, album); }
      }, { signal });
      entry.seek.value = String(deck.time);
    }
    for (const input of mix) input.addEventListener('input', () => engine.setMix(input.dataset.mix as 'master' | 'cross', Number(input.value)), { signal });

    for (const card of cards) {
      card.addEventListener('dragstart', event => event.dataTransfer?.setData('application/x-ps-record', card.dataset.recordAlbum!), { signal });
      for (const button of card.querySelectorAll<HTMLButtonElement>('[data-load-side]')) {
        button.addEventListener('click', () => loadAlbum(Number(button.dataset.loadSide) as Side, card.dataset.recordAlbum!), { signal });
      }
    }

    function sync() {
      for (const side of sides) {
        const deck = engine.decks[side];
        const entry = values[side];
        if (deck.track && observedTracks[side] !== deck.track.id) {
          observedTracks[side] = deck.track.id;
          if (entry.track.value !== deck.track.id) listTracks(side, deck.track.album, deck.track.id);
        }
        entry.buttons.play.textContent = deck.loading ? 'Loading' : deck.playing ? 'Stop' : 'Start';
        entry.buttons.play.disabled = deck.loading;
        entry.buttons.previous.disabled = !trackNeighbor(side, -1);
        entry.buttons.next.disabled = !trackNeighbor(side, 1);
        entry.buttons.play.setAttribute('aria-pressed', String(deck.playing));
        entry.buttons.rpm.textContent = `${deck.rpm} RPM`;
        entry.buttons.loop.setAttribute('aria-pressed', String(deck.loop));
        entry.buttons.monitor.setAttribute('aria-pressed', String(deck.monitoring));
        entry.buttons.cue.setAttribute('aria-pressed', String(deck.cuePoint !== undefined));
        entry.buttons.in.setAttribute('aria-pressed', String(deck.loopIn !== undefined));
        entry.buttons.out.setAttribute('aria-pressed', String(deck.loopOut !== undefined));
        for (const action of ['cue', 'store', 'in', 'out', 'loop', 'reverse', 'forward', 'sync']) entry.buttons[action].disabled = !deck.track || deck.loading || !!deck.error;
        const other = engine.tempo(side === 0 ? 1 : 0), mine = engine.tempo(side);
        entry.buttons.sync.setAttribute('aria-pressed', String(!!other && !!mine && Math.abs(other - mine) < 0.05));
        entry.hot.forEach((button, pad) => {
          const time = deck.hotCues[pad];
          button.setAttribute('aria-pressed', String(time !== undefined));
          button.textContent = time === undefined ? `Cue ${pad + 1}` : `${pad + 1} · ${format(time)}`;
          button.disabled = !deck.track || deck.loading || !!deck.error;
        });
        entry.beats.forEach(button => {
          button.setAttribute('aria-pressed', String(deck.loop && deck.loopBeats === Number(button.dataset.beats)));
          button.disabled = !deck.track || deck.loading || !!deck.error;
        });
        const filter = engine.filterAmount(side);
        if (document.activeElement !== entry.filter) entry.filter.value = String(filter);
        entry.filterRead.value = filter < -0.02 ? `dark ${Math.round(-filter * 100)}%` : filter > 0.02 ? `thin ${Math.round(filter * 100)}%` : 'off';
        const recordDuration = engine.recordPosition(side, selected(side))?.record.duration ?? 0;
        entry.seek.disabled = !recordDuration || deck.loading;
        entry.seek.max = String(recordDuration || 1);
        entry.waveform.value = deck.waveformScope;
        entry.pitch.value = String(deck.pitch);
        entry.pitchRead.value = `${deck.pitch > 0 ? '+' : ''}${Math.round(deck.pitch * 10) / 10}%`;
        entry.effect.value = String(effects.indexOf(deck.effect));
        for (const input of entry.channel) input.value = String(deck.controls[input.dataset.channel as ChannelControl]);
        const tempo = deck.track?.bpm ? ` · ${Math.round(deck.track.bpm * engine.speed(side))} BPM` : '';
        entry.readout.textContent = deck.error || (deck.loading ? 'Decoding audio…' : deck.playing ? `Playing${tempo}` : deck.track ? `Ready${tempo}` : 'Select a track and start the deck');
      }
      for (const input of mix) input.value = String(engine[input.dataset.mix as 'master' | 'cross']);
      record.textContent = engine.recording ? 'Stop & download' : 'Record mix';
      record.setAttribute('aria-pressed', String(engine.recording));
    }
    const progress = () => sides.forEach(side => {
      const deck = engine.decks[side];
      const entry = values[side];
      const record = engine.recordPosition(side, selected(side));
      if (document.activeElement !== entry.seek) {
        entry.seek.value = String(record?.time ?? 0);
        entry.seek.setAttribute('aria-valuetext', `${format(record?.time ?? 0)} / ${format(record?.record.duration ?? 0)}`);
      }
      const now = `${format(deck.time)} / ${format(deck.duration)}`;
      if (entry.time.textContent !== now) entry.time.textContent = now;
    });
    engine.addEventListener('change', sync, { signal });
    const timer = window.setInterval(progress, 80);
    signal.addEventListener('abort', () => clearInterval(timer), { once: true });
    sync();
    progress();

    // the letters printed on the decks' keys: 1/2 play, Q W E R / U I O P hot cues
    // (shift clears), A / J cue, S / K sync. Caught on the window first, so the
    // site player's own keys (k, p…) don't fire too.
    const deckKeys = [
      { play: '1', cue: 'a', sync: 's', pads: ['q', 'w', 'e', 'r'] },
      { play: '2', cue: 'j', sync: 'k', pads: ['u', 'i', 'o', 'p'] },
    ];
    window.addEventListener('keydown', event => {
      if (event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey ||
        (event.target as Element)?.closest?.('input, select, textarea, [contenteditable]') ||
        document.querySelector('dialog[open]:not(#booth-controls), .viz:not([hidden])')) return;
      const key = event.key.toLowerCase();
      for (const side of sides) {
        const keys = deckKeys[side];
        const deck = engine.decks[side];
        const ready = !!deck.track && !deck.loading && !deck.error;
        let act: (() => void) | undefined;
        if (key === keys.play) act = () => toggle(side);
        else if (key === keys.cue) act = () => ready && (event.shiftKey ? engine.setCue(side) : engine.cue(side));
        else if (key === keys.sync) act = () => ready && engine.sync(side);
        else if (keys.pads.includes(key)) {
          const pad = keys.pads.indexOf(key);
          act = () => event.shiftKey ? engine.clearHotCue(side, pad) : ready ? engine.hotCue(side, pad) : toggle(side);
        }
        if (!act) continue;
        event.preventDefault();
        event.stopImmediatePropagation();
        act();
        return;
      }
    }, { signal, capture: true });

    // The site's player is playing something: carry it on, on deck A, from
    // where it is. The header player keeps playing while the deck decodes, and
    // pauses itself the moment the deck starts (see Player.astro), so there's
    // no gap and no double audio.
    const site = (window as Window & { __ps?: PlayerBridge & { playing?: () => boolean } }).__ps;
    const siteItem = site?.native().item;
    const handover = !activeBooth() && site?.playing?.() && siteItem ? trackById.get(siteItem.id) : undefined;
    if (handover) {
      // continue the same song, not a variation of it: neutral tempo and filter,
      // no effect, and make sure channel A can be heard
      const a = engine.decks[0];
      if (a.pitch) engine.setPitch(0, 0);
      if (a.rpm !== 33) engine.toggleRpm(0);
      if (engine.filterAmount(0)) engine.setFilter(0, 0);
      if (a.effect !== 'off') engine.setEffect(0, 0);
      if (a.controls.volume < 0.2) engine.setChannel(0, 'volume', channelControls.volume.initial);
      if (engine.cross > 0.6) engine.setMix('cross', 0);
      load(0, handover, true);
    } else if (linked && engine.decks[0].track?.id !== linked.id) {
      // Keep the album selected until the first gesture can unlock Web Audio.
      status.textContent = `${linked.release} selected for deck A.`;
    }

    let scene: ReturnType<typeof createBoothScene> | undefined;
    const fallback = find('[data-fallback]');
    const labels = new Map([...this.querySelectorAll<HTMLTemplateElement>('template[data-vinyl-label]')]
      .map(template => [template.dataset.vinylLabel!, template]));
    const cameraButtons = this.querySelectorAll<HTMLButtonElement>('[data-view]');
    const onViewChange = (view: string) => {
      for (const button of cameraButtons) button.setAttribute('aria-pressed', String(button.dataset.view === view));
    };
    import('./scene').then(({ createBoothScene }) => {
      if (signal.aborted) return;
      scene = createBoothScene(stage, engine, crate, { play: toggle, step, canStep, load: loadAlbum, monitor, record: recordMix, selected, onViewChange, labels });
      fallback.hidden = true;
    }).catch(() => {
      if (signal.aborted) return;
      fallback.textContent = '3D rendering is unavailable. Open Controls to use the decks and mixer.';
      find('.booth-cameras').hidden = true;
      find('.booth-gestures').hidden = true;
    });
    for (const button of cameraButtons) button.addEventListener('click', () => {
      const view = button.dataset.view as Parameters<NonNullable<typeof scene>['view']>[0];
      if (!scene) return;
      scene.view(view);
    }, { signal });
    signal.addEventListener('abort', () => scene?.dispose(), { once: true });
  }

  disconnectedCallback() {
    this.listeners?.abort();
    this.listeners = undefined;
  }
}
