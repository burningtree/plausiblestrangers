import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { channelControls, effects, effectLabels, mixDefaults, type BoothRelease, type BoothTrack, type ChannelControl, type Side, type boothAudio } from './audio';

import { deckDisplay, deckScreen } from './deck-display';
import type { RecordTimeline } from './record';
import { drawVinylLabel } from './label-texture';

type Engine = ReturnType<typeof boothAudio>;
type View = 'studio' | 'overhead' | 'a' | 'b' | 'mixer' | 'crate';
type Action = {
  label: string;
  press?: (event: PointerEvent) => void;
  drag?: (value: number) => void;
  get?: () => number;
  reset?: () => void;
  seekAt?: (worldX: number) => number;
  armAngle?: () => number;
  available?: () => boolean;
  shape?: T.Mesh[];
  side?: Side;
  type?: 'scratch' | 'arm' | 'record';
  album?: string;
  /** keys that act while held (nudge) */
  hold?: (down: boolean) => void;
  /** the current value in words, shown with the label while hovering or turning */
  describe?: () => string;
};
interface SceneOptions {
  play: (side: Side) => void;
  step: (side: Side, direction: -1 | 1) => void;
  canStep: (side: Side, direction: -1 | 1) => boolean;
  load: (side: Side, album: string) => void;
  monitor: (side: Side) => void;
  record: () => void;
  selected: (side: Side) => BoothTrack | undefined;
  onViewChange: (view: View) => void;
  labels: ReadonlyMap<string, HTMLTemplateElement>;
}

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const range = (value: number, min: number, max: number) => min + value * (max - min);
const TAU = Math.PI * 2;
const deckX = [-3.48, 3.48] as const;
const deckDisplayY = 0.290;
const armStart = -0.50;
const armEnd = -0.855;
const ivory = 0xe1ded2;
const ink = 0x292a29;
const orange = 0xed6a31;
const yellow = 0xe5b744;
const blue = 0x365dc8;
const mint = 0xc0ebbe;


export function createBoothScene(host: HTMLElement, engine: Engine, releases: BoothRelease[], options: SceneOptions) {
  let disposed = false;
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(39, 1, 0.1, 60);
  const narrow = () => host.clientWidth < 680;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canvas = renderer.domElement;
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = !reduced;
  controls.enablePan = true;
  controls.minDistance = 2.6;
  controls.maxDistance = 28;
  controls.maxPolarAngle = Math.PI * 0.485;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = !narrow();
  renderer.shadowMap.type = T.PCFShadowMap;
  canvas.setAttribute('aria-hidden', 'true');
  canvas.addEventListener('contextmenu', event => event.preventDefault());
  host.prepend(canvas);

  const pmrem = new T.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, 0.045);
  room.dispose();
  pmrem.dispose();
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.64;
  scene.add(new T.HemisphereLight(0xe5ebfc, 0x625748, 1.35));
  const key = new T.DirectionalLight(0xffebd3, 3.0);
  key.position.set(-4, 8, 3);
  key.castShadow = renderer.shadowMap.enabled;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -8, right: 8, top: 7, bottom: -7, near: 0.5, far: 22 });
  key.shadow.normalBias = 0.022;
  key.shadow.bias = -0.0002;
  key.shadow.radius = 3;
  scene.add(key);
  const fill = new T.DirectionalLight(0xdbe5f5, 0.9);
  fill.position.set(2, 4, -6);
  scene.add(fill);
  const ground = new T.Mesh(new T.PlaneGeometry(180, 180), new T.ShadowMaterial({ color: 0x000000, opacity: 0.30 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.367;
  ground.receiveShadow = true;
  scene.add(ground);

  const materials = new Map<string, T.MeshStandardMaterial>();
  const material = (color: number, metalness = 0, roughness = 0.6) => {
    const id = `${color}:${metalness}:${roughness}`;
    if (!materials.has(id)) materials.set(id, new T.MeshStandardMaterial({ color, metalness, roughness }));
    return materials.get(id)!;
  };
  const silver = material(0xaaa9a0, 0.75, 0.37);
  const aluminium = new T.MeshStandardMaterial({ color: 0xc0beb4, metalness: 0.63, roughness: 0.46, envMapIntensity: 0.73 });
  const dark = material(0x242628, 0.35, 0.52);
  const rubber = material(0x151617, 0, 0.88);
  const cream = material(ivory, 0.04, 0.68);
  const mixerMetal = material(0x41423e, 0.41, 0.61);
  const actions: T.Object3D[] = [];
  const animated: (() => void)[] = [];
  const textures = new Map<string, T.Texture>();
  const geometries = new Map<string, T.BufferGeometry>();
  const loader = new T.TextureLoader();

  function picture(url: string) {
    if (!textures.has(url)) {
      const map = loader.load(url);
      map.colorSpace = T.SRGBColorSpace;
      map.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
      textures.set(url, map);
    }
    return textures.get(url)!;
  }

  function mesh(parent: T.Object3D, geometry: T.BufferGeometry, mat: T.Material, x: number, y: number, z: number, shadow = false) {
    const object = new T.Mesh(geometry, mat);
    object.position.set(x, y, z);
    object.castShadow = shadow;
    object.receiveShadow = shadow;
    parent.add(object);
    return object;
  }

  function box(parent: T.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, mat: T.Material, bevel = 0, shadow = false) {
    const id = `box:${w}:${h}:${d}:${bevel}`;
    if (!geometries.has(id)) geometries.set(id, bevel ? new RoundedBoxGeometry(w, h, d, 1, bevel) : new T.BoxGeometry(w, h, d));
    return mesh(parent, geometries.get(id)!, mat, x, y, z, shadow);
  }

  function cylinder(parent: T.Object3D, radius: number, height: number, x: number, y: number, z: number, mat: T.Material, segments = 40, top = radius, shadow = false) {
    const id = `cylinder:${radius}:${height}:${segments}:${top}`;
    if (!geometries.has(id)) geometries.set(id, new T.CylinderGeometry(top, radius, height, segments));
    return mesh(parent, geometries.get(id)!, mat, x, y, z, shadow);
  }

  const unitPlane = new T.PlaneGeometry(1, 1);
  function plane(parent: T.Object3D, w: number, d: number, x: number, y: number, z: number, mat: T.Material) {
    const object = mesh(parent, unitPlane, mat, x, y, z);
    object.scale.set(w, d, 1);
    object.rotation.x = -Math.PI / 2;
    return object;
  }

  function surfaceTexture(width: number, height: number) {
    const surface = document.createElement('canvas');
    surface.width = width;
    surface.height = height;
    const ctx = surface.getContext('2d')!;
    const map = new T.CanvasTexture(surface);
    map.colorSpace = T.SRGBColorSpace;
    map.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
    return { surface, ctx, map };
  }

  // A fine directional texture catches the light on the anodized faceplates.
  const brushing = surfaceTexture(256, 256);
  brushing.map.colorSpace = T.NoColorSpace;
  for (let row = 0; row < 256; row++) {
    const value = 200 + Math.round(21 * Math.sin(row * 2.39) + 10 * Math.cos(row * 0.8));
    brushing.ctx.fillStyle = `rgb(${value}, ${value}, ${value})`;
    brushing.ctx.fillRect(0, row, 256, 1);
  }
  aluminium.roughnessMap = brushing.map;

  const labelMaps = new Map<string, T.CanvasTexture>();

  function vinylLabel(album?: string, fallback?: string) {
    const template = album ? options.labels.get(album) : undefined;
    if (!template || !album) return fallback ? picture(fallback) : null;
    const cached = labelMaps.get(album);
    if (cached) return cached;
    const label = surfaceTexture(512, 512);
    label.ctx.fillStyle = '#4b4437';
    label.ctx.fillRect(0, 0, 512, 512);
    labelMaps.set(album, label.map);
    void drawVinylLabel(template, label.surface).then(() => {
      if (!disposed) label.map.needsUpdate = true;
    }).catch(() => {
      if (!fallback || disposed) return;
      const image = new Image();
      image.onload = () => {
        if (disposed) return;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 512;
        canvas.getContext('2d')!.drawImage(image, 0, 0, 512, 512);
        label.map.image = canvas;
        label.map.needsUpdate = true;
      };
      image.src = fallback;
    });
    return label.map;
  }

  function mark(parent: T.Object3D, text: string, x: number, z: number, size = 0.1, color = '#302e2a', y = 0.281, align: 'center' | 'left' = 'center', weight = '500', family = 'monospace') {
    const key = `mark:${text}:${color}:${weight}:${family}`;
    const height = 56, font = `${weight} 38px ${family}`;
    let map = textures.get(key);
    if (!map) {
      const measuring = document.createElement('canvas').getContext('2d')!;
      measuring.font = font;
      const width = Math.ceil(measuring.measureText(text).width) + 8;
      const label = surfaceTexture(width, height);
      label.ctx.font = font;
      label.ctx.fillStyle = color;
      label.ctx.textBaseline = 'middle';
      label.ctx.fillText(text, 4, height / 2 + 1);
      map = label.map;
      textures.set(key, map);
    }
    const width = size * (map.image as HTMLCanvasElement).width / height;
    return plane(parent, width, size, x + (align === 'left' ? width / 2 : 0), y, z, new T.MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1 }));
  }

  const outlineMaterial = new T.MeshBasicMaterial({ color: 0xffc775, side: T.BackSide, toneMapped: false });
  outlineMaterial.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normal * 0.022;');
  };
  const outlines = new Map<T.Mesh, T.Mesh>();
  let highlighted: T.Mesh[] | undefined;

  function highlight(shape?: T.Mesh[]) {
    if (shape === highlighted) return;
    for (const target of highlighted ?? []) outlines.get(target)!.visible = false;
    highlighted = shape;
    for (const target of shape ?? []) {
      let outline = outlines.get(target);
      if (!outline) {
        outline = new T.Mesh(target.geometry, outlineMaterial);
        outlines.set(target, outline);
        target.add(outline);
      }
      outline.visible = true;
    }
  }

  function hit(object: T.Mesh, action: Action) {
    object.userData.action = action;
    actions.push(object);
  }

  function screw(parent: T.Object3D, x: number, z: number) {
    cylinder(parent, 0.044, 0.009, x, 0.28, z, dark, 24);
    cylinder(parent, 0.036, 0.012, x, 0.286, z, silver, 24);
    const slot = box(parent, 0.042, 0.003, 0.009, x, 0.293, z, dark);
    slot.rotation.y = (x + z) * 3;
  }

  // ---- Teenage Engineering–style hardware: flat grey slabs, printed mono
  // labels, big colour-coded knobs, square keys with little LEDs.
  const body = material(0xc4c2bb, 0.06, 0.64);
  const bodyEdge = material(0xa9a7a0, 0.06, 0.7);
  const mixerBody = material(0x30312e, 0.12, 0.66);
  const keycap = material(0xf1f0eb, 0.02, 0.6);
  const padcap = material(0xe2e0d9, 0.02, 0.62);
  const print = '#2b2a27';
  const printSoft = '#7a776f';
  const deckColour = [0xf05a1a, 0x2f66ea] as const;
  const green = 0x2fae78;
  const grey = 0x9a9893;
  const white = 0xf4f3ee;

  // the slab: a thin rounded body, a darker underside, small feet
  function casework(parent: T.Object3D, width: number, top: T.Material, depth: number, center: number) {
    box(parent, width, 0.3, depth, 0, 0.13, center, top, 0.07, true);
    box(parent, width - 0.06, 0.12, depth - 0.06, 0, -0.06, center, top === mixerBody ? rubber : bodyEdge, 0.04, true);
    for (const x of [-width / 2 + 0.3, width / 2 - 0.3]) {
      for (const z of [center - depth / 2 + 0.3, center + depth / 2 - 0.3]) {
        cylinder(parent, 0.11, 0.1, x, -0.16, z, rubber, 24, 0.11, true);
      }
    }
    for (const x of [-width / 2 + 0.14, width / 2 - 0.14]) {
      for (const z of [center - depth / 2 + 0.14, center + depth / 2 - 0.14]) screw(parent, x, z);
    }
  }

  const invisible = new T.MeshBasicMaterial({ visible: false });

  // a key: a square cap that travels, a printed caption, an LED that lights
  function button(parent: T.Object3D, x: number, z: number, width: number, caption: string, cap: T.Material, action: Action,
    on?: () => boolean, led = 0xff6a2b, depth = 0.3, captionColor = print, shortcut?: string) {
    const key = new T.Group();
    key.position.set(x, 0.312, z);
    parent.add(key);
    // a soft shadow line around the cap instead of a black well
    box(parent, width + 0.02, 0.004, depth + 0.02, x, 0.281, z, material(0x8e8c85, 0, 0.9), 0.008);
    const top = box(key, width, 0.06, depth, 0, 0.0, 0, cap, 0.025, true);
    mark(key, caption, 0, 0.0, Math.min(0.1, 0.85 * width / (caption.length * 0.62)), captionColor, 0.032, 'center', '700');
    if (shortcut) mark(key, shortcut, width / 2 - 0.055, depth / 2 - 0.05, 0.055, captionColor === print ? printSoft : captionColor, 0.031);
    // the LED is only there when it's on
    const ledMat = on ? new T.MeshBasicMaterial({ color: led, toneMapped: false }) : undefined;
    const ledDot = ledMat ? cylinder(key, 0.026, 0.006, -width / 2 + 0.06, 0.031, -depth / 2 + 0.06, ledMat, 16) : undefined;
    hit(top, { ...action, shape: [top], press: event => {
      key.userData.pressed = performance.now() + 135;
      action.press?.(event);
    } });
    hit(box(parent, width + 0.04, 0.12, depth + 0.04, x, 0.33, z, invisible), top.userData.action);
    animated.push(() => {
      const target = (key.userData.pressed ?? 0) > performance.now() || key.userData.held ? 0.298 : 0.312;
      key.position.y = T.MathUtils.lerp(key.position.y, target, 0.32);
      if (ledDot) ledDot.visible = on!();
    });
    return key;
  }

  // a knob: a tall coloured cylinder with a pointer on top, ticks printed around it
  function knob(parent: T.Object3D, x: number, z: number, caption: string, color: number, get: () => number, set: (value: number) => void,
    initial: number, size = 1, labelColor = print, describe?: () => string) {
    const r = 0.2 * size;
    cylinder(parent, r * 1.22, 0.02, x, 0.29, z, rubber, 48);
    const dial = new T.Group();
    dial.position.set(x, 0.3, z);
    parent.add(dial);
    const height = 0.13 * size;
    const cap = cylinder(dial, r, height, 0, height / 2, 0, material(color, 0.04, 0.5), 48, r * 0.97, true);
    const pointer = color === white || color === grey ? material(0x2b2a27) : material(0xffffff);
    box(dial, 0.028 * size, 0.006, r * 0.55, 0, height + 0.003, -r * 0.5, pointer, 0.002);
    for (let i = 0; i <= 10; i++) {
      const angle = range(i / 10, 2.36, -2.36);
      const tick = box(parent, i % 5 ? 0.008 : 0.014, 0.003, 0.045, x + Math.sin(angle) * r * 1.42, 0.282, z - Math.cos(angle) * r * 1.42, material(labelColor === print ? 0x2b2a27 : 0xd8d6cf));
      tick.rotation.y = -angle;
    }
    mark(parent, caption, x, z + r * 1.95, 0.08, labelColor, 0.283, 'center', '700');
    const action: Action = { label: caption, get, drag: set, reset: () => set(initial), shape: [cap], describe };
    hit(cap, action);
    animated.push(() => dial.rotation.y = range(get(), 2.36, -2.36));
  }

  // a fader: a slot, a chunky cap with a coloured line
  function fader(parent: T.Object3D, x: number, z: number, length: number, caption: string, color: number, get: () => number, set: (value: number) => void,
    initial: number, horizontal = false, textColor = '#e9e3d4', describe?: () => string) {
    const base = new T.Group();
    base.position.set(x, 0, z);
    base.rotation.y = horizontal ? -Math.PI / 2 : 0;
    parent.add(base);
    box(base, 0.06, 0.012, length + 0.08, 0, 0.282, 0, rubber, 0.003);
    for (let i = 0; i <= 4; i++)
      box(base, i % 2 ? 0.03 : 0.06, 0.004, 0.01, 0.12, 0.282, range(i / 4, -length / 2, length / 2), material(0x8d8b84));
    const cap = box(base, 0.3, 0.1, 0.17, 0, 0.34, 0, keycap, 0.025, true);
    box(cap, 0.24, 0.006, 0.03, 0, 0.051, 0, material(color), 0.002);
    const action: Action = { label: caption, get, drag: set, reset: () => set(initial), shape: [cap], describe };
    hit(cap, action);
    hit(box(base, 0.32, 0.18, length + 0.14, 0, 0.35, 0, invisible), action);
    mark(parent, caption, x, z + (horizontal ? 0.27 : length / 2 + 0.22), 0.085, textColor, 0.283, 'center', '600');
    animated.push(() => cap.position.z = range(get(), length / 2, -length / 2));
  }

  const groove = surfaceTexture(768, 768);
  const grooveRadius = 384;
  const gradient = groove.ctx.createRadialGradient(384, 384, 0, 384, 384, 384);
  gradient.addColorStop(0, '#202123');
  gradient.addColorStop(0.91, '#141518');
  gradient.addColorStop(1, '#2d2e30');
  groove.ctx.fillStyle = gradient;
  groove.ctx.fillRect(0, 0, 768, 768);
  for (let r = 103; r < grooveRadius; r += 1.35) {
    groove.ctx.beginPath();
    groove.ctx.arc(384, 384, r, 0, TAU);
    groove.ctx.strokeStyle = r % 9 < 2 ? '#323336' : r % 3 < 1.5 ? '#0d0d0e' : '#222325';
    groove.ctx.lineWidth = 0.7;
    groove.ctx.stroke();
  }
  for (const r of [117, 133, 209, 275, 319, 377]) {
    groove.ctx.beginPath();
    groove.ctx.arc(384, 384, r, 0, TAU);
    groove.ctx.strokeStyle = '#3f4044';
    groove.ctx.lineWidth = 1.2;
    groove.ctx.stroke();
  }
  groove.map.needsUpdate = true;
  const vinylSurface = new T.MeshStandardMaterial({ map: groove.map, roughness: 0.44, metalness: 0.12 });
  function disc(parent: T.Object3D, radius: number) {
    const group = new T.Group();
    parent.add(group);
    const edge = cylinder(group, radius, 0.037, 0, 0, 0, rubber, 96);
    const face = mesh(group, new T.CircleGeometry(radius - 0.004, 96), vinylSurface, 0, 0.019, 0);
    face.rotation.x = -Math.PI / 2;
    const labelMat = new T.MeshStandardMaterial({ color: 0xbfb8a4, roughness: 0.86 });
    const label = mesh(group, new T.CircleGeometry(radius * 0.34, 64), labelMat, 0, 0.022, 0);
    label.rotation.x = -Math.PI / 2;
    const setLabel = (album?: string, fallback?: string) => {
      const map = vinylLabel(album, fallback);
      labelMat.map = map;
      labelMat.color.setHex(map ? 0xffffff : 0xbfb8a4);
      labelMat.needsUpdate = true;
    };
    return { group, face, edge, setLabel };
  }

  function display(parent: T.Object3D, x: number, z: number, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => string, resolution = { width: 650, height: 190 }, flush = false) {
    const bezel = box(parent, w + 0.052, flush ? 0.014 : 0.039, h + 0.052, x, flush ? 0.281 : 0.288, z, flush ? dark : rubber, 0.004);
    const label = surfaceTexture(resolution.width, resolution.height);
    label.map.generateMipmaps = false;
    label.map.minFilter = T.LinearFilter;
    plane(parent, w, h, x, flush ? deckDisplayY : 0.311, z, new T.MeshBasicMaterial({ map: label.map, toneMapped: false }));
    let last = '';
    animated.push(() => {
      const state = draw(label.ctx);
      if (state !== last) {
        last = state;
        label.map.needsUpdate = true;
      }
    });
    return bezel;
  }

  // ---- a deck (PS-01): the record on top, then four big knobs, the screen,
  // hot-cue pads and loop keys, and the transport along the front
  const deckDepth = 6.6, deckCenter = 1.13;
  const rows = { knobs: 1.85, screen: 2.78, pads: 3.55, keys: 4.1 };
  const deckKeys = [
    { play: '1', cue: 'A', sync: 'S', pads: ['Q', 'W', 'E', 'R'] },
    { play: '2', cue: 'J', sync: 'K', pads: ['U', 'I', 'O', 'P'] },
  ];
  function turntable(side: Side) {
    const name = side ? 'B' : 'A';
    const deck = engine.decks[side];
    const accent = deckColour[side];
    const keys = deckKeys[side];
    const recordPosition = () => engine.recordPosition(side, options.selected(side));
    const seek = (fraction: number) => {
      const position = recordPosition();
      if (position) engine.seekRecord(side, fraction * position.record.duration, options.selected(side));
    };
    const preview = () => drag?.action.side === side ? drag.recordFraction : undefined;
    const canSeek = () => !deck.loading && (recordPosition()?.record.duration ?? 0) > 0;
    const loaded = () => !!deck.track && !deck.loading && !deck.error;
    const group = new T.Group();
    group.position.x = deckX[side];
    scene.add(group);
    casework(group, 4.25, body, deckDepth, deckCenter);
    mark(group, 'PS-01', -1.86, -1.9, 0.17, print, 0.282, 'left', '700', 'sans-serif');
    mark(group, `DECK ${name} · 33/45 · DIRECT DRIVE`, -1.86, -1.72, 0.07, printSoft, 0.282, 'left', '500');
    cylinder(group, 0.15, 0.012, 1.86, 0.283, -1.86, material(accent), 32);
    mark(group, name, 1.86, -1.86, 0.15, '#ffffff', 0.291, 'center', '700', 'sans-serif');

    // the record: a recessed well, a light platter with a strobe ring, a black mat
    const x = -0.37, z = -0.13;
    cylinder(group, 1.5, 0.03, x, 0.27, z, rubber, 96, 1.5);
    cylinder(group, 1.43, 0.15, x, 0.403, z, bodyEdge, 96, 1.43, true);
    const dots = new T.InstancedMesh(new T.BoxGeometry(0.018, 0.03, 0.01), material(accent), 60);
    const transform = new T.Object3D();
    for (let i = 0; i < dots.count; i++) {
      const angle = i / dots.count * TAU;
      transform.position.set(Math.sin(angle) * 1.432, 0.416, Math.cos(angle) * 1.432);
      transform.rotation.y = angle;
      transform.updateMatrix();
      dots.setMatrixAt(i, transform.matrix);
    }
    dots.position.set(x, 0, z);
    group.add(dots);
    cylinder(group, 1.391, 0.023, x, 0.487, z, rubber, 96);
    const vinyl = disc(group, 1.365);
    vinyl.group.position.set(x, 0.519, z);
    vinyl.group.visible = false;
    const scratch = { label: `Scratch deck ${name}`, type: 'scratch' as const, side, shape: [vinyl.edge] };
    hit(vinyl.face, scratch);
    hit(vinyl.edge, scratch);
    cylinder(group, 0.039, 0.10, x, 0.548, z, keycap, 20, 0.032);
    let lastTrack = '';
    let lastRecord: RecordTimeline | undefined;
    const bandGeometry = new T.RingGeometry(0.987, 1, 96);
    const bands: T.Mesh[] = [];
    animated.push(() => {
      const track = deck.track || options.selected(side);
      vinyl.group.visible = !!track;
      const fallback = track?.label ?? track?.cover;
      const label = track && options.labels.has(track.album) ? track.album : (fallback ?? '');
      if (label !== lastTrack) { lastTrack = label; vinyl.setLabel(track?.album, fallback); }
      const record = recordPosition()?.record;
      if (record !== lastRecord) {
        lastRecord = record;
        const segments = record?.segments.slice(1) ?? [];
        const duration = record?.duration || 1;
        for (let i = 0; i < segments.length; i++) {
          const angle = range(segments[i].offset / duration, armStart, armEnd);
          const stylusX = 1.42 + 0.236 * Math.cos(angle) + 2.005 * Math.sin(angle);
          const stylusZ = -1.35 - 0.236 * Math.sin(angle) + 2.005 * Math.cos(angle);
          let band = bands[i];
          if (!band) {
            band = mesh(vinyl.group, bandGeometry, material(0x2d2c2a, 0.08, 0.72), 0, 0.0205, 0);
            band.rotation.x = -Math.PI / 2;
            bands.push(band);
          }
          band.scale.setScalar(Math.hypot(stylusX - x, stylusZ - z));
        }
        bands.forEach((band, i) => band.visible = i < segments.length);
      }
      const age = Math.min(0.024, (performance.now() - deck.angleAt) / 1000);
      const angle = deck.angle + deck.rate * age * TAU * (100 / 3) / 60;
      vinyl.group.rotation.y = -angle;
      dots.rotation.y = -angle;
    });

    // the tonearm: a white arm, a counterweight in the deck's colour
    const pivot = new T.Group();
    pivot.position.set(1.42, 0.64, -1.35);
    group.add(pivot);
    const base = cylinder(group, 0.233, 0.157, 1.42, 0.354, -1.35, rubber, 48, 0.233, true);
    cylinder(group, 0.19, 0.2, 1.42, 0.50, -1.35, keycap, 40, 0.168, true);
    const hinge = new T.Group();
    pivot.add(hinge);
    const armMat = material(0xf4f3ee, 0.1, 0.4);
    const arm = box(hinge, 0.07, 0.05, 1.9, 0, 0, 0.63, armMat, 0.02, true);
    const offset = box(hinge, 0.07, 0.05, 0.46, 0.093, -0.012, 1.68, armMat, 0.02, true);
    offset.rotation.y = 0.51;
    box(hinge, 0.2, 0.15, 0.27, 0, 0, -0.264, material(accent, 0.05, 0.5), 0.04);
    const shell = box(hinge, 0.159, 0.053, 0.285, 0.2, -0.025, 1.92, rubber, 0.015, true);
    shell.rotation.y = 0.35;
    box(hinge, 0.056, 0.025, 0.143, 0.205, -0.056, 1.963, material(accent), 0.004);
    cylinder(hinge, 0.014, 0.065, 0.236, -0.084, 2.005, keycap, 12, 0.007);
    cylinder(group, 0.062, 0.20, 1.49, 0.371, 0.04, rubber, 24);
    const lift = { label: `Lift tonearm and seek the record · ${name}`, type: 'arm' as const, side, shape: [arm, offset, shell], available: canSeek, armAngle: () => pivot.rotation.y, reset: () => seek(0) };
    hit(base, lift);
    hit(arm, lift);
    hit(offset, lift);
    hit(shell, lift);
    hit(box(hinge, 0.26, 0.13, 0.61, 0.13, -0.045, 1.69, invisible), lift);
    animated.push(() => {
      const record = recordPosition();
      const seeking = preview();
      const fraction = seeking ?? (record?.record.duration ? clamp(record.time / record.record.duration) : 0);
      const lifted = drag?.action.type === 'arm' && drag.action.side === side;
      const angle = deck.track || seeking !== undefined ? range(fraction, armStart, armEnd) : -0.03;
      pivot.rotation.y = T.MathUtils.lerp(pivot.rotation.y, angle, 0.28);
      hinge.rotation.x = T.MathUtils.lerp(hinge.rotation.x, lifted ? -0.16 : (deck.playing || deck.rate !== 0 ? 0 : -0.052), 0.2);
    });

    // four big knobs: tempo (the deck's colour), filter (green), fx (grey), trim (white)
    const pct = (n: number, digits = 1) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n).toFixed(digits)}`;
    knob(group, -1.5, rows.knobs, 'TEMPO', accent, () => (deck.pitch + 16) / 32, v => engine.setPitch(side, range(v, -16, 16)), 0.5, 1, print,
      () => `${pct(deck.pitch)}%${engine.tempo(side) ? ` · ${engine.tempo(side)!.toFixed(1)} bpm` : ''}`);
    knob(group, -0.5, rows.knobs, 'FILTER', green, () => (engine.filterAmount(side) + 1) / 2, v => engine.setFilter(side, range(v, -1, 1)), 0.5, 1, print,
      () => { const f = engine.filterAmount(side); return f < -0.02 ? `◀ dark ${Math.round(-f * 100)}%` : f > 0.02 ? `thin ${Math.round(f * 100)}% ▶` : 'off'; });
    knob(group, 0.5, rows.knobs, `FX ${name}`, grey, () => effects.indexOf(deck.effect) / (effects.length - 1), v => engine.setEffect(side, Math.round(v * (effects.length - 1))), 0, 1, print,
      () => effectLabels[effects.indexOf(deck.effect)].toLowerCase());
    const trim = channelControls.gain;
    knob(group, 1.5, rows.knobs, 'TRIM', white, () => (deck.controls.gain - trim.min) / (trim.max - trim.min), v => engine.setChannel(side, 'gain', range(v, trim.min, trim.max)), (trim.initial - trim.min) / (trim.max - trim.min), 1, print,
      () => `${Math.round(deck.controls.gain * 100)}%`);

    // the screen: waveform, bpm, time, cue and loop, hot cues
    const screen = { width: 3.7, height: 0.45, z: rows.screen };
    box(group, screen.width + 0.1, 0.012, screen.height + 0.1, 0, 0.282, screen.z, rubber, 0.02);
    const face = display(group, 0, screen.z, screen.width, screen.height,
      deckDisplay(side, deck, recordPosition, preview, () => engine.speed(side)), deckScreen, true);
    const waveWidth = screen.width * (1 - 2 * deckScreen.inset / deckScreen.width);
    const waveDepth = screen.height * (deckScreen.waveBottom - deckScreen.waveTop) / deckScreen.height;
    const waveZ = screen.z + screen.height * ((deckScreen.waveBottom + deckScreen.waveTop) / (2 * deckScreen.height) - 0.5);
    hit(box(group, waveWidth, 0.015, waveDepth, 0, deckDisplayY + 0.004, waveZ, invisible), {
      label: `Click or drag the waveform · ${name}`,
      available: canSeek,
      side,
      seekAt: worldX => {
        const fraction = clamp((worldX - deckX[side]) / waveWidth + 0.5);
        const position = recordPosition();
        if (deck.waveformScope === 'record' || !position?.record.duration) return fraction;
        const { segment, record } = position;
        const time = Math.min(fraction * segment.duration, Math.max(0, segment.duration - 0.001));
        return (segment.offset + time) / record.duration;
      },
      shape: [face],
    });
    const { switchLeft, switchTop, switchWidth, switchHeight } = deckScreen;
    for (const [index, scope] of (['track', 'record'] as const).entries()) {
      const width = screen.width * switchWidth / (2 * deckScreen.width);
      const depth = screen.height * switchHeight / deckScreen.height;
      const sx = screen.width * ((switchLeft + (index + 0.5) * switchWidth / 2) / deckScreen.width - 0.5);
      const sz = screen.z + screen.height * ((switchTop + switchHeight / 2) / deckScreen.height - 0.5);
      hit(box(group, width, 0.015, depth, sx, deckDisplayY + 0.004, sz, invisible), {
        label: `Show ${scope === 'track' ? 'current track' : 'whole record'} waveform · ${name}`,
        press: () => engine.setWaveformScope(side, scope),
        shape: [face],
      });
    }

    // hot-cue pads (tap: set, then jump · shift-tap: clear) and loop keys in bars
    mark(group, 'HOT CUE', -1.82, rows.pads - 0.29, 0.065, printSoft, 0.282, 'left', '700');
    keys.pads.forEach((shortcut, pad) => {
      button(group, -1.64 + pad * 0.43, rows.pads, 0.36, String(pad + 1), padcap, {
        label: `Hot cue ${pad + 1} · ${name} (tap to set or jump, shift-tap clears)`,
        press: event => event.shiftKey ? engine.clearHotCue(side, pad) : (loaded() ? engine.hotCue(side, pad) : options.play(side)),
      }, () => deck.hotCues[pad] !== undefined, accent, 0.36, print, shortcut);
    });
    mark(group, 'LOOP · BARS', 0.13, rows.pads - 0.29, 0.065, printSoft, 0.282, 'left', '700');
    [1, 2, 4, 8].forEach((bars, i) => {
      button(group, 0.31 + i * 0.43, rows.pads, 0.36, String(bars), keycap, {
        label: `Loop ${bars} bar${bars > 1 ? 's' : ''} · ${name} (again to stop)`,
        press: () => { if (loaded()) engine.beatLoop(side, bars * 4); },
        available: loaded,
      }, () => deck.loop && deck.loopBeats === bars * 4, accent, 0.36);
    });

    // the transport along the front
    const nudge = (dir: -1 | 1) => {
      let timer = 0;
      return (down: boolean) => {
        clearInterval(timer);
        if (down && deck.playing) {
          const rate = engine.speed(side) * (1 + dir * 0.06);
          engine.scratch(side, rate);
          timer = window.setInterval(() => engine.scratch(side, rate), 40);
        } else engine.releaseScratch(side);
      };
    };
    const transport = [
      { text: 'PLAY', width: 0.72, cap: material(accent, 0.04, 0.5), color: '#ffffff', led: 0xffffff, shortcut: keys.play,
        label: `Play / pause deck ${name}`, press: () => options.play(side), on: () => deck.playing },
      { text: 'CUE', width: 0.44, cap: keycap, led: 0xffb43d, shortcut: keys.cue,
        label: `Cue · ${name} (shift-click sets it here)`, press: (event: PointerEvent) => event.shiftKey ? engine.setCue(side) : engine.cue(side), on: () => deck.cuePoint !== undefined },
      { text: 'SYNC', width: 0.48, cap: keycap, led: accent, shortcut: keys.sync,
        label: `Sync tempo to the other deck · ${name}`, press: () => { if (loaded()) engine.sync(side); },
        on: () => { const a = engine.tempo(side), b = engine.tempo(side ? 0 : 1); return !!a && !!b && Math.abs(a - b) < 0.05; } },
      { text: '−', width: 0.3, cap: keycap, label: `Nudge slower (hold) · ${name}`, hold: nudge(-1) },
      { text: '+', width: 0.3, cap: keycap, label: `Nudge faster (hold) · ${name}`, hold: nudge(1) },
      { text: '◀◀', width: 0.3, cap: keycap, label: `Previous track · ${name}`, press: () => options.step(side, -1), available: () => options.canStep(side, -1) },
      { text: '▶▶', width: 0.3, cap: keycap, label: `Next track · ${name}`, press: () => options.step(side, 1), available: () => options.canStep(side, 1) },
      { text: '33/45', width: 0.44, cap: keycap, led: 0xffb43d, label: `33 or 45 rpm · ${name}`, press: () => engine.toggleRpm(side), on: () => deck.rpm === 45 },
    ];
    const gap = 0.06;
    let left = -(transport.reduce((total, key) => total + key.width, 0) + gap * (transport.length - 1)) / 2;
    for (const key of transport) {
      const k = button(group, left + key.width / 2, rows.keys, key.width, key.text, key.cap,
        { label: key.label, press: key.press, available: key.available, hold: key.hold && (down => { k.userData.held = down; key.hold!(down); }) },
        key.on, key.led, 0.3, key.color ?? print, key.shortcut);
      left += key.width + gap;
    }
  }

  // ---- the mixer (PS-02): a dark slab between the decks
  function mixer() {
    const group = new T.Group();
    scene.add(group);
    const light = '#e7e4db', soft = '#a19e95';
    casework(group, 2.45, mixerBody, deckDepth, deckCenter);
    mark(group, 'PS-02', -1.02, -1.9, 0.17, light, 0.282, 'left', '700', 'sans-serif');
    mark(group, 'TWO-CHANNEL MIXER', -1.02, -1.72, 0.07, soft, 0.282, 'left', '500');

    // the screen: each deck's tempo and effect
    box(group, 2.1, 0.012, 0.52, 0, 0.282, -1.25, rubber, 0.02);
    display(group, 0, -1.25, 2.0, 0.42, ctx => {
      const state = engine.decks.map((deck, side) => `${deck.effect}:${engine.tempo(side as Side)?.toFixed(1)}:${deck.playing}`).join('|');
      if (ctx.canvas.dataset.state === state) return state;
      ctx.canvas.dataset.state = state;
      ctx.fillStyle = '#151615';
      ctx.fillRect(0, 0, 650, 190);
      ctx.font = 'bold 44px monospace';
      for (const side of [0, 1] as const) {
        const deck = engine.decks[side];
        const bpm = engine.tempo(side);
        ctx.fillStyle = side ? '#9cb9ff' : '#ffb67c';
        ctx.fillText(`${side ? 'B' : 'A'}${deck.playing ? '▶' : ' '}`, 26, 72 + 80 * side);
        ctx.fillStyle = '#eee9dd';
        ctx.fillText(bpm ? `${bpm.toFixed(1)}` : '—', 120, 72 + 80 * side);
        ctx.fillStyle = '#bdb8ae';
        ctx.textAlign = 'right';
        ctx.fillText(effectLabels[effects.indexOf(deck.effect)].toUpperCase().slice(0, 10), 624, 72 + 80 * side);
        ctx.textAlign = 'left';
      }
      return state;
    });

    // per channel: three EQ knobs, a headphone key and the volume fader
    for (const side of [0, 1] as const) {
      const x = side ? 0.7 : -0.7;
      const deck = engine.decks[side];
      cylinder(group, 0.12, 0.012, x, 0.283, -0.72, material(deckColour[side]), 32);
      mark(group, side ? 'B' : 'A', x, -0.72, 0.13, '#ffffff', 0.291, 'center', '700', 'sans-serif');
      const eq = (key: ChannelControl, z: number, caption: string, color: number) => {
        const spec = channelControls[key];
        knob(group, x, z, caption, color, () => (deck.controls[key] - spec.min) / (spec.max - spec.min), v => engine.setChannel(side, key, range(v, spec.min, spec.max)),
          (spec.initial - spec.min) / (spec.max - spec.min), 0.78, light, () => `${deck.controls[key] > 0 ? '+' : ''}${deck.controls[key].toFixed(1)} dB`);
      };
      eq('high', -0.2, 'HI', white);
      eq('mid', 0.45, 'MID', grey);
      eq('low', 1.1, 'LO', deckColour[side]);
      if (engine.canMonitor) button(group, x, 1.85, 0.42, 'PFL', material(0x4a4b47, 0.05, 0.6), { label: `Headphone cue · ${side ? 'B' : 'A'}`, press: () => options.monitor(side) }, () => deck.monitoring, 0xffb43d, 0.28, light);
      fader(group, x, 2.95, 1.0, side ? 'CH B' : 'CH A', deckColour[side], () => deck.controls.volume, v => engine.setChannel(side, 'volume', v), channelControls.volume.initial, false, light,
        () => `${Math.round(deck.controls.volume * 100)}%`);
    }

    // the middle: level meters, master, record
    for (const channel of [0, 1] as const) {
      const leds: T.MeshStandardMaterial[] = [];
      const meterX = channel ? 0.11 : -0.11;
      mark(group, channel ? 'R' : 'L', meterX, -0.72, 0.075, soft);
      box(group, 0.11, 0.02, 0.86, meterX, 0.285, -0.15, rubber, 0.015);
      for (let i = 0; i < 10; i++) {
        const color = i > 8 ? 0xff4d3d : i > 6 ? 0xffb43d : 0xf1efe8;
        const led = new T.MeshStandardMaterial({ color: 0x3a3b38, emissive: color, emissiveIntensity: 0 });
        leds.push(led);
        box(group, 0.07, 0.02, 0.05, meterX, 0.3, 0.21 - i * 0.075, led, 0.008);
      }
      let rms = 0, peakAt = 0, lastSample = performance.now();
      animated.push(() => {
        const now = performance.now();
        const level = engine.masterLevels(channel);
        const target = clamp((20 * Math.log10(level.rms || 0.0001) + 40) / 40);
        rms = Math.max(target, rms - (now - lastSample) / 280);
        lastSample = now;
        if (level.peak > 0.98) peakAt = now + 520;
        leds.forEach((led, i) => led.emissiveIntensity = i === 9 ? Number(peakAt > now) * 2 : rms * 9 > i ? 1.8 : 0);
      });
    }
    knob(group, 0, 1.0, 'MASTER', white, () => engine.master, v => engine.setMix('master', v), mixDefaults.master, 0.78, light, () => `${Math.round(engine.master * 100)}%`);
    if (typeof MediaRecorder !== 'undefined') button(group, 0, 1.85, 0.42, 'REC', material(0xd1301f, 0.05, 0.55), { label: 'Record the mix (again to stop and save)', press: options.record }, () => engine.recording, 0xffffff, 0.28, '#ffffff');
    fader(group, 0, 4.02, 1.5, 'A  ◀  MIX  ▶  B', white, () => (engine.cross + 1) / 2, v => engine.setMix('cross', range(v, -1, 1)), (mixDefaults.cross + 1) / 2, true, light,
      () => engine.cross < -0.02 ? `◀ A ${Math.round(-engine.cross * 100)}%` : engine.cross > 0.02 ? `B ${Math.round(engine.cross * 100)}% ▶` : 'centre');
  }

  let drag: { id: number; action: Action; x: number; y: number; value: number; angle?: number; at: number; moved: boolean; armOffset?: number; recordFraction?: number } | undefined;
  turntable(0);
  mixer();
  turntable(1);

  const crate = new T.Group();
  crate.position.set(0, -0.26, -3.43);
  scene.add(crate);
  const spacing = Math.min(1.57, 9.6 / releases.length);
  const crateWidth = spacing * releases.length + 0.27;
  box(crate, crateWidth, 0.20, 1.25, 0, 0, 0, dark, 0.04, true);
  box(crate, crateWidth, 0.27, 0.07, 0, 0.18, 0.64, mixerMetal, 0.02, true);
  box(crate, crateWidth, 0.40, 0.07, 0, 0.28, -0.60, mixerMetal, 0.02, true);
  releases.forEach((release, i) => {
    const sleeve = new T.Group();
    const size = Math.min(1.42, spacing * 0.94);
    sleeve.position.set((i - (releases.length - 1) / 2) * spacing, 0.11 + size / 2, 0.03);
    sleeve.rotation.x = -0.27;
    sleeve.rotation.y = (i - (releases.length - 1) / 2) * 0.025;
    crate.add(sleeve);
    mark(crate, release.catalog.toUpperCase(), sleeve.position.x, 0.647, 0.079, '#e7d9b9', 0.318);
    const cover = box(sleeve, size, size, 0.079, 0, 0, 0, material(0xada18b), 0.021, true);
    const art = (url: string, back = false) => {
      const face = mesh(sleeve, unitPlane, new T.MeshStandardMaterial({ map: picture(url), roughness: 0.84, metalness: 0.03 }), 0, 0, back ? -0.041 : 0.041);
      face.scale.set(size * 0.977, size * 0.977, 1);
      face.rotation.y = back ? Math.PI : 0;
    };
    if (release.cover) art(release.cover);
    if (release.back) art(release.back, true);
    const inner = disc(sleeve, size * 0.425);
    inner.setLabel(release.id, release.label ?? release.cover);
    inner.group.rotation.x = Math.PI / 2;
    inner.group.position.set(0, size * 0.20, -0.065);
    const action = { label: `Drag ${release.title} onto a deck`, type: 'record' as const, album: release.id, shape: [cover, inner.edge] };
    hit(cover, action);
    hit(inner.face, action);
    hit(inner.edge, action);
  });
  const ghost = disc(scene, 0.78);
  ghost.group.visible = false;
  const targetRings = deckX.map(x => {
    const ring = mesh(scene, new T.RingGeometry(1.50, 1.525, 96), new T.MeshBasicMaterial({ color: orange, depthWrite: false, transparent: true, opacity: 0.8 }), x - 0.37, 0.53, -0.13);
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;
    return ring;
  });

  const ray = new T.Raycaster();
  const point = new T.Vector2();
  const position = new T.Vector3();
  const surface = new T.Plane(new T.Vector3(0, 1, 0), -0.52);
  const displayPlane = new T.Plane(new T.Vector3(0, 1, 0), -deckDisplayY);
  const tooltip = host.querySelector<HTMLElement>('[data-scene-hint]');
  let targetSide: Side | undefined;
  function aim(event: MouseEvent) {
    const bounds = canvas.getBoundingClientRect();
    point.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
    ray.setFromCamera(point, camera);
  }

  function pick(): Action | undefined {
    const action = ray.intersectObjects(actions, false)
      .find(({ object }) => object.parent?.visible && object.parent.parent?.visible && object.userData.action.available?.() !== false)
      ?.object.userData.action as Action | undefined;
    if (action?.type === 'scratch') {
      const side = action.side!;
      const deck = engine.decks[side];
      if (!deck.track || deck.error) return { label: `Start deck ${side ? 'B' : 'A'}`, press: () => options.play(side), shape: action.shape };
    }
    return action;
  }

  function waveformFraction(event: PointerEvent, seekAt: (worldX: number) => number) {
    aim(event);
    if (ray.ray.intersectPlane(displayPlane, position)) return seekAt(position.x);
  }

  function inspect(event: PointerEvent) {
    if (!drag) {
      aim(event);
      const action = pick();
      canvas.style.cursor = action?.seekAt ? 'ew-resize' : action ? (action.press ? 'pointer' : 'grab') : 'move';
      if (!controlsGesture) {
        highlight(event.pointerType === 'touch' ? undefined : action?.shape);
        if (tooltip) tooltip.textContent = action ? describe(action) : '';
      }
      return;
    }
    if (drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    const { action } = drag;
    drag.moved ||= Math.hypot(dx, dy) > 4;
    if (action.drag && drag.moved) {
      const horizontal = action.label.startsWith('A  ◀');
      action.drag(clamp(drag.value + (horizontal ? dx : (dx * 0.25 - dy)) / 150));
      if (tooltip) tooltip.textContent = describe(action);
    }
    if (action.seekAt && drag.moved) drag.recordFraction = waveformFraction(event, action.seekAt) ?? drag.recordFraction;
    if (action.type === 'arm' && drag.moved) {
      const side = action.side!;
      aim(event);
      if (ray.ray.intersectPlane(surface, position)) {
        const pointerAngle = Math.atan2(position.x - deckX[side] - 1.42, position.z + 1.35);
        const pivotAngle = pointerAngle - (drag.armOffset ?? 0);
        drag.recordFraction = clamp((pivotAngle - armStart) / (armEnd - armStart));
      }
    }
    if (action.type === 'scratch') {
      aim(event);
      if (ray.ray.intersectPlane(surface, position)) {
        const angle = Math.atan2(position.x - deckX[action.side!] + 0.37, position.z + 0.13);
        const difference = drag.angle === undefined ? 0 : Math.atan2(Math.sin(angle - drag.angle), Math.cos(angle - drag.angle));
        engine.scratch(action.side!, -difference / Math.max(0.009, (event.timeStamp - drag.at) / 1000) / (TAU * (100 / 3) / 60));
        drag.angle = angle;
        drag.at = event.timeStamp;
      }
    }
    if (action.type === 'record' && drag.moved) {
      aim(event);
      if (ray.ray.intersectPlane(surface, position)) {
        ghost.group.position.set(position.x, 0.70, position.z);
        ghost.group.visible = true;
        const index = deckX.findIndex(x => Math.abs(position.x - x) < 2.18 && Math.abs(position.z) < 2.22);
        targetSide = index < 0 ? undefined : index as Side;
        targetRings.forEach((ring, side) => ring.visible = side === targetSide);
      }
    }
  }
  // what a control is, what it's set to, and how to reset it
  function describe(action: Action) {
    const value = action.describe?.();
    return `${action.label}${value ? ` · ${value}` : ''}${action.reset ? ' · double-click resets' : ''}`;
  }
  let controlsGesture = false;
  function clearHover() {
    highlight();
    if (tooltip) tooltip.textContent = '';
  }
  controls.addEventListener('start', () => { controlsGesture = true; clearHover(); });
  controls.addEventListener('end', () => { controlsGesture = false; });

  const listeners = new AbortController();
  const signal = listeners.signal;
  canvas.addEventListener('pointerdown', event => {
    if (drag) { event.stopImmediatePropagation(); return; }
    if (event.button !== 0) return;
    aim(event);
    const action = pick();
    if (!action) { transition = undefined; return; }
    event.stopImmediatePropagation();
    event.preventDefault();
    transition = undefined;
    canvas.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, action, x: event.clientX, y: event.clientY, value: action.get?.() ?? 0, at: event.timeStamp, moved: false };
    canvas.style.cursor = 'grabbing';
    if (event.pointerType !== 'touch') highlight(action.shape);
    if (action.seekAt) drag.recordFraction = waveformFraction(event, action.seekAt);
    action.hold?.(true);
    if (action.type === 'scratch') inspect(event);
    if (action.type === 'arm') {
      const side = action.side!;
      if (ray.ray.intersectPlane(surface, position)) {
        const x = position.x - deckX[side] - 1.42;
        const z = position.z + 1.35;
        const pointerAngle = Math.atan2(x, z);
        drag.armOffset = Math.hypot(x, z) > 0.35 ? pointerAngle - (action.armAngle?.() ?? 0) : Math.atan2(0.236, 2.005);
      }
      engine.lift(side, true);
    }
    if (action.type === 'record') {
      const release = releases.find(release => release.id === action.album);
      ghost.setLabel(release?.id, release?.label ?? release?.cover);
    }
  }, { capture: true, signal });
  canvas.addEventListener('pointermove', inspect, { signal });
  function end(event: PointerEvent) {
    if (drag?.id !== event.pointerId) return;
    const { action, moved } = drag;
    if (event.type === 'pointerup' && drag.recordFraction !== undefined && action.side !== undefined) {
      const side = action.side;
      const fraction = action.seekAt ? waveformFraction(event, action.seekAt) ?? drag.recordFraction : drag.recordFraction;
      const selected = options.selected(side);
      const record = engine.recordPosition(side, selected)?.record;
      if (record) engine.seekRecord(side, fraction * record.duration, selected);
    }
    if (action.type === 'scratch') engine.releaseScratch(action.side!);
    if (action.type === 'arm') engine.lift(action.side!, false);
    action.hold?.(false);
    if (action.type === 'record' && event.type === 'pointerup' && targetSide !== undefined) options.load(targetSide, action.album!);
    if (!moved && event.type === 'pointerup' && action.press) {
      action.press(event);
      engine.click();
    }
    ghost.group.visible = false;
    targetRings.forEach(ring => ring.visible = false);
    targetSide = undefined;
    drag = undefined;
    if (event.type === 'pointerup') inspect(event);
    else clearHover();
  }
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) canvas.addEventListener(type, end, { signal });
  canvas.addEventListener('pointerleave', () => { if (!drag) clearHover(); }, { signal });
  canvas.addEventListener('dblclick', event => {
    aim(event);
    const action = pick();
    if (action?.reset) {
      action.reset();
    } else if (!action) {
      view('studio');
    }
  }, { signal });
  canvas.addEventListener('wheel', event => {
    aim(event);
    const action = pick();
    if (action?.drag && !event.ctrlKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const step = action.label.startsWith('FX') ? 1 / (effects.length - 1) : 0.035;
      action.drag(clamp((action.get?.() ?? 0) - Math.sign(event.deltaY) * step));
      if (tooltip) tooltip.textContent = describe(action);
    } else transition = undefined;
  }, { passive: false, capture: true, signal });
  let transition: { camera: T.Vector3; target: T.Vector3; from: T.Vector3; fromTarget: T.Vector3; started: number } | undefined;
  let lastView: View = 'studio';
  function framing(view: View) {
    const mobile = narrow();
    const sides = view === 'a' || view === 'b';
    const x = sides ? deckX[view === 'b' ? 1 : 0] : 0;
    // the decks reach from the crate (z ≈ -2) to their front keys (z ≈ 3.8)
    const focus = view === 'crate' ? -3.30 : sides ? 1.25 : view === 'mixer' ? 1.2 : 0.5;
    const eye = view === 'overhead' ? [0, mobile ? 24 : 14.2, focus + 0.035]
      : view === 'crate' ? [0, mobile ? 9.9 : 5.1, 3.9]
      : view === 'mixer' ? [0, 7.0, 5.6]
      : sides ? [x + (view === 'a' ? -0.8 : 0.8), 6.8, 7.2]
      : [0.04, mobile ? 16.2 : 9.9, mobile ? 17.4 : 11.0];
    return { camera: new T.Vector3(...eye), target: new T.Vector3(x, view === 'crate' ? 0.45 : 0.13, focus) };
  }

  function view(name: View, immediate = false) {
    lastView = name;
    clearHover();
    options.onViewChange(name);
    const destination = framing(name);
    if (immediate || reduced) {
      transition = undefined;
      camera.position.copy(destination.camera);
      controls.target.copy(destination.target);
      controls.update();
    } else {
      transition = { ...destination, from: camera.position.clone(), fromTarget: controls.target.clone(), started: performance.now() };
    }
  }

  let wasNarrow = narrow();
  const observer = new ResizeObserver(() => {
    if (!host.clientWidth || !host.clientHeight) return;
    renderer.setPixelRatio(Math.min(devicePixelRatio, narrow() ? 1.15 : 1.65));
    renderer.setSize(host.clientWidth, host.clientHeight, false);
    camera.aspect = host.clientWidth / host.clientHeight;
    const referenceAspect = narrow() ? 0.85 : 1.68;
    camera.fov = T.MathUtils.radToDeg(2 * Math.atan(Math.tan(T.MathUtils.degToRad(39 / 2)) * Math.max(1, referenceAspect / camera.aspect)));
    camera.updateProjectionMatrix();
    if (wasNarrow !== narrow()) { wasNarrow = narrow(); view(lastView, true); }
  });
  observer.observe(host);
  view('studio', true);

  let visible = true;
  const intersection = new IntersectionObserver(([entry]) => visible = entry.isIntersecting);
  intersection.observe(host);
  let lastFrame = 0;
  const frame = (now: number) => {
    if (!visible || document.hidden || (narrow() && now - lastFrame < 30)) return;
    lastFrame = now;
    if (transition) {
      const progress = clamp((now - transition.started) / 740);
      const eased = progress * progress * (3 - 2 * progress);
      camera.position.lerpVectors(transition.from, transition.camera, eased);
      controls.target.lerpVectors(transition.fromTarget, transition.target, eased);
      if (progress === 1) transition = undefined;
    }
    controls.update();
    for (const animate of animated) animate();
    renderer.render(scene, camera);
  };
  renderer.setAnimationLoop(frame);

  return {
    view,
    dispose() {
      disposed = true;
      if (drag?.action.type === 'scratch') engine.releaseScratch(drag.action.side!);
      if (drag?.action.type === 'arm') engine.lift(drag.action.side!, false);
      listeners.abort();
      observer.disconnect();
      intersection.disconnect();
      controls.dispose();
      renderer.setAnimationLoop(null);
      const usedMaterials = new Set<T.Material>([outlineMaterial]);
      const usedGeometries = new Set<T.BufferGeometry>();
      scene.traverse(object => {
        if (!(object instanceof T.Mesh)) return;
        usedGeometries.add(object.geometry);
        for (const mat of Array.isArray(object.material) ? object.material : [object.material]) {
          usedMaterials.add(mat);
        }
      });
      const usedTextures = new Set<T.Texture>(labelMaps.values());
      usedMaterials.forEach(mat => {
        const { map, roughnessMap } = mat as T.MeshStandardMaterial;
        if (map) usedTextures.add(map);
        if (roughnessMap) usedTextures.add(roughnessMap);
        mat.dispose();
      });
      usedGeometries.forEach(geometry => geometry.dispose());
      usedTextures.forEach(texture => texture.dispose());
      environment.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
