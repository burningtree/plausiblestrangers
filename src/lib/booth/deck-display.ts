import type { Side, boothAudio } from './audio';
import { segmentAt, type RecordPosition } from './record';

type Deck = ReturnType<typeof boothAudio>['decks'][Side];
export const deckScreen = {
  width: 1152, height: 152, inset: 21, waveTop: 51, waveBottom: 116,
  switchLeft: 179, switchTop: 126, switchWidth: 193, switchHeight: 24,
} as const;

const waveWidth = deckScreen.width - 2 * deckScreen.inset;
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const fraction = (value: number) => Math.max(0, Math.min(1, value));

export function deckDisplay(side: Side, deck: Deck, position: () => RecordPosition | undefined, preview: () => number | undefined, speed: () => number) {
  let previous = '';
  const accent = side ? '#9cb9ff' : '#ffb67c';
  const cue = '#ffcf87';
  const foreground = '#eee9dd';
  const secondary = '#bdb8ae';
  const name = side ? 'B' : 'A';

  return (ctx: CanvasRenderingContext2D) => {
    const placement = position();
    const record = placement?.record;
    const recordDuration = record?.duration ?? 0;
    const previewFraction = preview();
    const recordTime = previewFraction === undefined ? (placement?.time ?? 0) : previewFraction * recordDuration;
    const segment = previewFraction !== undefined && record ? segmentAt(record, recordTime) : placement?.segment;
    const track = segment?.track;
    const trackIsLoaded = !!track && deck.track?.id === track.id;
    const trackDuration = (trackIsLoaded && deck.duration ? deck.duration : segment?.duration) ?? 0;
    const elapsed = segment?.duration ? fraction((recordTime - segment.offset) / segment.duration) * trackDuration : 0;
    const recordView = deck.waveformScope === 'record';
    const waveOffset = recordView ? 0 : (segment?.offset ?? 0);
    const waveDuration = recordView ? recordDuration : (segment?.duration ?? 0);
    const timeX = (time: number) => deckScreen.inset + (waveDuration ? fraction((time - waveOffset) / waveDuration) : 0) * waveWidth;
    const trackTimeX = (time: number) => timeX((placement?.segment.offset ?? 0) + (deck.duration ? fraction(time / deck.duration) : 0) * (placement?.segment.duration ?? 0));
    const cursor = Math.round(timeX(recordTime));
    const status = previewFraction !== undefined ? 'SEEK'
      : deck.loading ? 'READING' : deck.error ? 'READ ERROR' : deck.playing ? 'PLAYING'
      : deck.track ? (deck.rate > 0.025 ? 'STOPPING' : 'READY') : track ? 'SELECTED' : 'EMPTY';
    const detune = `${deck.pitch > 0 ? '+' : ''}${deck.pitch.toFixed(1)}%`;
    const state = [track?.id, status, recordView, recordDuration, clock(elapsed), clock(recordTime), cursor,
      deck.rpm, detune, deck.cuePoint, deck.loopIn, deck.loopOut, deck.loop, deck.waveform?.length].join('|');
    if (state === previous) return state;
    previous = state;

    const { width, height, inset, waveTop, waveBottom } = deckScreen;
    const end = width - inset;
    const center = (waveTop + waveBottom) / 2;
    ctx.fillStyle = '#191a19';
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = '#343531';
    ctx.fillRect(inset, 43, waveWidth, 1);
    ctx.fillRect(inset, 122, waveWidth, 1);
    ctx.fillRect(164, 12, 1, 23);
    ctx.fillRect(inset, center, waveWidth, 1);


    const showMarkers = recordView || trackIsLoaded;
    if (showMarkers && deck.loopIn !== undefined && deck.loopOut !== undefined && deck.loopOut > deck.loopIn) {
      ctx.fillStyle = deck.loop ? (side ? '#303f5e' : '#543c2c') : '#2d2e2a';
      ctx.fillRect(trackTimeX(deck.loopIn), waveTop, trackTimeX(deck.loopOut) - trackTimeX(deck.loopIn), waveBottom - waveTop);
    }

    const entries = recordView ? (record?.segments ?? []) : segment ? [segment] : [];
    for (const entry of entries) {
      const start = timeX(entry.offset);
      const finish = timeX(entry.offset + entry.duration);
      const span = finish - start;
      const levels = (entry.track.id === deck.track?.id ? deck.waveform : undefined) ?? entry.track.waveform ?? entry.track.peaks;
      const count = Math.min(levels.length, Math.max(1, Math.floor(span / 3)));
      const band = span / count;
      for (let i = 0; i < count; i++) {
        const from = Math.floor(i * levels.length / count);
        const to = Math.floor((i + 1) * levels.length / count);
        let peak = 0;
        for (let j = from; j < to; j++) peak = Math.max(peak, levels[j]);
        const x = start + i * band;
        const amplitude = Math.max(1, fraction(peak) * 26);
        ctx.fillStyle = x < cursor ? '#d1cec2' : '#84847b';
        ctx.fillRect(x, center - amplitude, Math.max(1, band - 1.25), amplitude * 2);
      }
      if (recordView && entry.offset > 0) {
        ctx.fillStyle = '#191a19';
        ctx.fillRect(start - 2, waveTop, 4, waveBottom - waveTop);
        ctx.fillStyle = '#97968d';
        ctx.fillRect(start, waveTop, 1, waveBottom - waveTop);
      }
    }

    for (const boundary of [deck.loopIn, deck.loopOut]) {
      if (!showMarkers || boundary === undefined) continue;
      ctx.fillStyle = deck.loop ? accent : secondary;
      const x = trackTimeX(boundary);
      ctx.fillRect(x - 1, waveTop, 2, waveBottom - waveTop);
      ctx.fillRect(x - 3, waveBottom - 4, 6, 4);
    }
    if (showMarkers && deck.cuePoint !== undefined) {
      ctx.fillStyle = cue;
      const x = trackTimeX(deck.cuePoint);
      ctx.fillRect(x - 1, waveTop, 2, waveBottom - waveTop);
      ctx.beginPath();
      ctx.moveTo(x - 5, waveTop);
      ctx.lineTo(x + 5, waveTop);
      ctx.lineTo(x, waveTop + 8);
      ctx.fill();
    }
    if (segment && (!deck.error || previewFraction !== undefined)) {
      ctx.fillStyle = accent;
      ctx.fillRect(cursor - 1, waveTop - 3, 3, waveBottom - waveTop + 6);
    }

    ctx.fillStyle = accent;
    ctx.font = 'bold 22px monospace';
    ctx.fillText(name, inset, 30);
    ctx.fillStyle = secondary;
    ctx.font = '20px monospace';
    ctx.fillText(status, 46, 30);

    ctx.fillStyle = foreground;
    ctx.font = 'bold 29px monospace';
    const title = Array.from((track?.title ?? 'Insert record').toUpperCase());
    const count = Math.floor(538 / ctx.measureText('M').width);
    ctx.fillText(title.length > count ? title.slice(0, count - 1).join('').trimEnd() + '…' : title.join(''), 183, 31, 538);

    ctx.font = 'bold 23px monospace';
    ctx.textAlign = 'right';
    const bpm = track?.bpm ? Math.round(track.bpm * speed()) : '—';
    ctx.fillText(`${bpm} BPM    ${deck.rpm} RPM    ${detune}`, end, 30);
    ctx.textAlign = 'left';

    ctx.fillStyle = secondary;
    ctx.font = '20px monospace';
    ctx.fillText(`${clock(elapsed)} / ${trackDuration ? clock(trackDuration) : '—:—'}`, inset, 144);
    if (record && segment) {
      ctx.fillText(`TRK ${record.segments.indexOf(segment) + 1}/${record.segments.length}`, 394, 144);
      if (recordView) ctx.fillText(`REC ${clock(recordTime)} / ${clock(recordDuration)}`, 510, 144);
    }

    const { switchLeft, switchTop, switchWidth, switchHeight } = deckScreen;
    const half = switchWidth / 2;
    ctx.font = '17px monospace';
    ctx.textAlign = 'center';
    for (const [index, label] of ['TRACK', 'RECORD'].entries()) {
      const active = recordView === (index === 1);
      const x = switchLeft + index * half;
      ctx.fillStyle = active ? '#373832' : '#23241f';
      ctx.fillRect(x, switchTop, half - 1, switchHeight);
      ctx.fillStyle = active ? accent : secondary;
      ctx.fillText(label, x + half / 2, 144);
    }
    ctx.textAlign = 'left';

    if (showMarkers && deck.cuePoint !== undefined) {
      ctx.fillStyle = cue;
      ctx.fillText(`CUE ${clock(deck.cuePoint)}`, 738, 144);
    }
    if (showMarkers && deck.loopIn !== undefined) {
      ctx.fillStyle = deck.loop ? accent : secondary;
      ctx.textAlign = 'right';
      const span = deck.loopOut === undefined ? `${clock(deck.loopIn)} IN` : `${clock(deck.loopIn)}–${clock(deck.loopOut)}`;
      ctx.fillText(`LOOP ${span}`, end, 144);
      ctx.textAlign = 'left';
    }
    return state;
  };
}
