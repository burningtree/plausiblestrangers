// The site player's <audio> runs through Web Audio once something needs it (the
// visualiser's analyser, or the stems taking over the sound). The browser lets a
// page grab an <audio> element only once, ever, so everyone shares this graph:
//   <audio> → analyser → mix gain → speakers
let graph: { actx: AudioContext; analyser: AnalyserNode; mix: GainNode } | undefined;

export function mixGraph() {
  if (graph) return graph;
  const audio = document.getElementById('ps-audio') as HTMLAudioElement;
  const AC = window.AudioContext || (window as any).webkitAudioContext;
  const actx: AudioContext = new AC();
  const source = actx.createMediaElementSource(audio);
  const analyser = actx.createAnalyser();
  const mix = actx.createGain();
  source.connect(analyser);
  analyser.connect(mix);
  mix.connect(actx.destination);
  graph = { actx, analyser, mix };
  return graph;
}
