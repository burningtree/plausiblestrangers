// Match the title rows printed into the 1400 × 1400 back-cover artwork.
type TrackLayout = [x: number, y: number, width: number, height: number, rowStep: number, columns?: number, columnStep?: number];

const layouts: Partial<Record<string, TrackLayout>> = {
  'baroque-acid': [121, 638, 668, 76, 94],
  'who-holds-whom': [74, 955, 606, 100, 136, 2, 645],
  'make-room': [80, 341, 586, 68, 98],
  'the-door': [444, 404, 512, 87, 101],
  'i-am-your-bug': [70, 286, 638, 47, 52],
  probably: [108, 485, 818, 57, 66],
};

export function printedTrackStyle(release: string, position: number) {
  const layout = layouts[release];
  if (!layout) return;
  const [x, y, width, height, rowStep, columns = 1, columnStep = 0] = layout;
  const percent = (value: number) => `${value / 14}%`;
  return {
    left: percent(x + (position % columns) * columnStep),
    top: percent(y + Math.floor(position / columns) * rowStep),
    width: percent(width),
    height: percent(height),
  };
}

export type PrintedTrack = {
  id: string;
  index: number;
  title: string;
  style: NonNullable<ReturnType<typeof printedTrackStyle>>;
};
