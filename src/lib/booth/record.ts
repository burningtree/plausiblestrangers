import type { BoothTrack } from './audio';

export interface RecordSegment {
  track: BoothTrack;
  offset: number;
  duration: number;
}

export interface RecordTimeline {
  segments: RecordSegment[];
  duration: number;
}

export interface RecordPosition {
  record: RecordTimeline;
  segment: RecordSegment;
  time: number;
}

export function recordTimelines(library: BoothTrack[]) {
  const records = new Map<string, RecordTimeline>();
  for (const track of library) {
    if (!records.has(track.album)) records.set(track.album, { segments: [], duration: 0 });
    const record = records.get(track.album)!;
    record.segments.push({ track, offset: record.duration, duration: track.duration });
    record.duration += track.duration;
  }
  return records;
}

export function segmentAt(record: RecordTimeline, time: number) {
  return record.segments.find(segment => time + 1e-8 < segment.offset + segment.duration) ?? record.segments.at(-1);
}
