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

  function casework(parent: T.Object3D, width: number, top: T.Material) {
    const depth = 4.77;
    const center = 0.21;
    box(parent, width, 0.29, depth, 0, 0.063, center, silver, 0.009, true);
    box(parent, width - 0.045, 0.145, depth - 0.045, 0, -0.138, center, dark, 0.01, true);
    box(parent, width - 0.014, 0.018, depth - 0.014, 0, 0.212, center, dark, 0.004);
    box(parent, width - 0.028, 0.056, depth - 0.028, 0, 0.25, center, top, 0.009, true);
    for (const x of [-width / 2 + 0.15, width / 2 - 0.15]) {
      for (const z of [center - depth / 2 + 0.15, center + depth / 2 - 0.15]) {
        box(parent, 0.29, 0.17, 0.26, x * 0.83, -0.278, center + (z - center) * 0.83, rubber, 0.012, true);
        screw(parent, x, z);
      }
    }
  }

  const invisible = new T.MeshBasicMaterial({ visible: false });
  function button(parent: T.Object3D, x: number, z: number, width: number, caption: string, color: number, action: Action, on?: () => boolean, frontLed?: number) {
    const button = new T.Group();
    button.position.set(x, 0.294, z);
    parent.add(button);
    box(parent, width + 0.045, 0.009, 0.315, x, 0.281, z, rubber, 0.004);
    const cap = box(button, width, 0.073, 0.272, 0, 0.012, 0, material(color, 0.02, 0.69), 0.007, true);
    mark(button, caption, 0, 0.006, Math.min(0.12, 0.88 * width / (caption.length * 0.42)), color === ink || color === blue ? '#f2efe3' : '#282724', 0.052);
    const panelLed = on && frontLed !== undefined
      ? new T.MeshBasicMaterial({ color: 0x87847a, toneMapped: false })
      : undefined;
    if (panelLed) box(parent, 0.128, 0.004, 0.026, x, 0.283, z + 0.239, panelLed, 0.001);
    const ledMat = on && !panelLed
      ? new T.MeshStandardMaterial({ color: 0x504d47, emissive: 0xffa452, roughness: 0.55 })
      : undefined;
    if (ledMat) box(parent, 0.071, 0.008, 0.018, x, 0.283, z - 0.196, ledMat);
    hit(cap, { ...action, shape: [cap], press: event => {
      button.userData.pressed = performance.now() + 135;
      action.press?.(event);
    } });
    hit(box(parent, width + 0.06, 0.12, 0.37, x, 0.33, z, invisible), cap.userData.action);
    animated.push(() => {
      const target = (button.userData.pressed ?? 0) > performance.now() ? 0.274 : 0.294;
      button.position.y = T.MathUtils.lerp(button.position.y, target, 0.32);
      const lit = on?.();
      if (panelLed) panelLed.color.setHex(lit ? frontLed! : 0x87847a);
      if (ledMat) ledMat.emissiveIntensity = lit ? 2.3 : 0;
    });
  }

  function knob(parent: T.Object3D, x: number, z: number, caption: string, color: number, get: () => number, set: (value: number) => void, initial: number, indicator = color === ink ? ivory : ink) {
    const base = cylinder(parent, 0.161, 0.023, x, 0.29, z, rubber, 40);
    const dial = new T.Group();
    dial.position.set(x, 0.302, z);
    parent.add(dial);
    const cap = cylinder(dial, 0.142, 0.102, 0, 0.052, 0, material(color, 0.05, 0.69), 48, 0.137, true);
    box(dial, 0.021, 0.005, 0.078, 0, 0.105, -0.077, material(indicator), 0.001);
    mark(parent, caption, x, z + 0.231, 0.105, '#eae7dc');
    for (const angle of [-2.23, 0, 2.23]) {
      const tick = box(parent, 0.01, 0.004, 0.023, x + Math.sin(angle) * 0.19, 0.281, z - Math.cos(angle) * 0.19, silver);
      tick.rotation.y = -angle;
    }
    const action = { label: caption, get, drag: set, reset: () => set(initial), shape: [cap] };
    hit(base, action);
    hit(cap, action);
    animated.push(() => dial.rotation.y = range(get(), 2.25, -2.25));
  }

  function fader(parent: T.Object3D, x: number, z: number, length: number, caption: string, color: number, get: () => number, set: (value: number) => void, initial: number, horizontal = false, textColor = '#e9e3d4') {
    const base = new T.Group();
    base.position.set(x, 0, z);
    base.rotation.y = horizontal ? -Math.PI / 2 : 0;
    parent.add(base);
    box(base, 0.053, 0.01, length + 0.055, 0, 0.281, 0, rubber, 0.002);
    for (let i = 0; i <= 4; i++)
      box(base, i % 2 ? 0.029 : 0.053, 0.004, 0.009, 0.091, 0.281, range(i / 4, -length / 2, length / 2), silver);
    const cap = box(base, 0.26, 0.068, 0.136, 0, 0.327, 0, color === ink ? dark : cream, 0.007, true);
    box(cap, 0.185, 0.005, 0.021, 0, 0.036, 0, material(color === ivory ? ink : color === ink ? ivory : color), 0.002);
    const action = { label: caption, get, drag: set, reset: () => set(initial), shape: [cap] };
    hit(cap, action);
    hit(box(base, 0.28, 0.16, length + 0.12, 0, 0.337, 0, invisible), action);
    mark(parent, caption, x, z + (horizontal ? 0.235 : length / 2 + 0.2), 0.106, textColor);
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

  function turntable(side: Side) {
    const name = side ? 'B' : 'A';
    const deck = engine.decks[side];
    const recordPosition = () => engine.recordPosition(side, options.selected(side));
    const seek = (fraction: number) => {
      const position = recordPosition();
      if (position) engine.seekRecord(side, fraction * position.record.duration, options.selected(side));
    };
    const preview = () => drag?.action.side === side ? drag.recordFraction : undefined;
    const canSeek = () => !deck.loading && (recordPosition()?.record.duration ?? 0) > 0;
    const group = new T.Group();
    group.position.x = deckX[side];
    scene.add(group);
    casework(group, 4.25, aluminium);
    const accent = side ? blue : orange;
    const labelColor = '#2b2c29';
    mark(group, 'PS-01', -1.78, -1.91, 0.221, labelColor, 0.282, 'left', '700', 'sans-serif');
    mark(group, `DIRECT DRIVE / 0${side + 1}`, -1.76, -1.71, 0.102, labelColor, 0.282, 'left');
    box(group, 0.25, 0.005, 0.24, 1.8, 0.282, -1.81, cream);
    mark(group, name, 1.8, -1.81, 0.148, labelColor, 0.287, 'center', '700', 'sans-serif');
    box(group, 3.65, 0.004, 0.011, 0, 0.281, 1.39, silver);
    const x = -0.37, z = -0.13;
    cylinder(group, 1.469, 0.043, x, 0.30, z, rubber, 96, 1.469, true);
    cylinder(group, 1.43, 0.15, x, 0.403, z, silver, 96, 1.43, true);
    cylinder(group, 1.427, 0.026, x, 0.379, z, dark, 96);
    const dots = new T.InstancedMesh(new T.BoxGeometry(0.013, 0.027, 0.008), dark, 48);
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
    for (const radius of [0.5, 0.75, 1, 1.25]) {
      const ring = mesh(group, new T.RingGeometry(radius, radius + 0.011, 80), dark, x, 0.501, z);
      ring.rotation.x = -Math.PI / 2;
    }
    const vinyl = disc(group, 1.365);
    vinyl.group.position.set(x, 0.519, z);
    vinyl.group.visible = false;
    const scratch = { label: `Scratch deck ${name}`, type: 'scratch' as const, side, shape: [vinyl.edge] };
    hit(vinyl.face, scratch);
    hit(vinyl.edge, scratch);
    cylinder(group, 0.039, 0.10, x, 0.548, z, silver, 20, 0.032);
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

    const pivot = new T.Group();
    pivot.position.set(1.42, 0.64, -1.35);
    group.add(pivot);
    const base = cylinder(group, 0.233, 0.157, 1.42, 0.354, -1.35, dark, 48, 0.233, true);
    cylinder(group, 0.19, 0.2, 1.42, 0.50, -1.35, silver, 40, 0.168, true);
    const hinge = new T.Group();
    pivot.add(hinge);
    const arm = box(hinge, 0.082, 0.05, 1.9, 0, 0, 0.63, silver, 0.005, true);
    const offset = box(hinge, 0.082, 0.05, 0.46, 0.093, -0.012, 1.68, silver, 0.005, true);
    offset.rotation.y = 0.51;
    box(hinge, 0.18, 0.13, 0.27, 0, 0, -0.264, dark, 0.008);
    const shell = box(hinge, 0.159, 0.053, 0.285, 0.2, -0.025, 1.92, dark, 0.006, true);
    shell.rotation.y = 0.35;
    box(hinge, 0.056, 0.025, 0.143, 0.205, -0.056, 1.963, material(accent), 0.004);
    cylinder(hinge, 0.014, 0.065, 0.236, -0.084, 2.005, silver, 12, 0.007);
    cylinder(group, 0.062, 0.20, 1.49, 0.371, 0.04, dark, 24);
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

    const channelLed = side ? 0x2960ed : 0xf25e24;
    const keys = [
      { text: 'START', width: 0.61, color: accent, led: channelLed, label: `Start/stop deck ${name}`,
        press: () => options.play(side), active: () => deck.playing },
      { text: 'PREV', width: 0.36, color: ivory, led: channelLed, label: `Previous track · ${name}`,
        press: () => options.step(side, -1), active: () => options.canStep(side, -1), available: () => options.canStep(side, -1) },
      { text: 'NEXT', width: 0.36, color: ivory, led: channelLed, label: `Next track · ${name}`,
        press: () => options.step(side, 1), active: () => options.canStep(side, 1), available: () => options.canStep(side, 1) },
      { text: '33 / 45', width: 0.49, color: ink, led: 0xb77815, label: `33/45 RPM · ${name}`,
        press: () => engine.toggleRpm(side), active: () => deck.rpm === 45 },
      { text: 'CUE', width: 0.43, color: ivory, led: 0xdd820e, label: `Cue · ${name} (Shift to set)`,
        press: (event: PointerEvent) => event.shiftKey ? engine.setCue(side) : engine.cue(side), active: () => deck.cuePoint !== undefined },
      { text: 'IN', width: 0.29, color: ivory, led: 0xb77815, label: `Set loop in · ${name}`,
        press: () => engine.markLoop(side, 'in'), active: () => deck.loopIn !== undefined },
      { text: 'OUT', width: 0.31, color: ivory, led: 0xb77815, label: `Set loop out · ${name}`,
        press: () => engine.markLoop(side, 'out'), active: () => deck.loopOut !== undefined },
      { text: 'LOOP', width: 0.45, color: ink, led: channelLed, label: `Loop deck ${name}`,
        press: () => engine.toggleLoop(side), active: () => deck.loop },
    ];
    const keyGap = 0.068;
    const width = keys.reduce((total, key) => total + key.width, 0) + (keys.length - 1) * keyGap;
    const screen = { width, height: 0.45, z: 1.68 };
    const face = display(group, 0, screen.z, screen.width, screen.height,
      deckDisplay(side, deck, recordPosition, preview, () => engine.speed(side)), deckScreen, true);
    const waveWidth = screen.width * (1 - 2 * deckScreen.inset / deckScreen.width);
    const waveDepth = screen.height * (deckScreen.waveBottom - deckScreen.waveTop) / deckScreen.height;
    const waveZ = screen.z + screen.height * ((deckScreen.waveBottom + deckScreen.waveTop) / (2 * deckScreen.height) - 0.5);
    hit(box(group, waveWidth, 0.015, waveDepth, 0, deckDisplayY + 0.004, waveZ, invisible), {
      label: `Click or drag the record waveform · ${name}`,
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
      const x = screen.width * ((switchLeft + (index + 0.5) * switchWidth / 2) / deckScreen.width - 0.5);
      const z = screen.z + screen.height * ((switchTop + switchHeight / 2) / deckScreen.height - 0.5);
      hit(box(group, width, 0.015, depth, x, deckDisplayY + 0.004, z, invisible), {
        label: `Show ${scope === 'track' ? 'current track' : 'whole record'} waveform · ${name}`,
        press: () => engine.setWaveformScope(side, scope),
        shape: [face],
      });
    }

    fader(group, 1.63, 0.49, 1.0, 'PITCH', side ? 0xc9c4b6 : ink,
      () => (deck.pitch + 16) / 32, value => engine.setPitch(side, range(value, -16, 16)), 0.5, false, labelColor);
    let left = -width / 2;
    for (const key of keys) {
      button(group, left + key.width / 2, 2.135, key.width, key.text, key.color,
        { label: key.label, press: key.press, available: key.available }, key.active, key.led);
      left += key.width + keyGap;
    }
  }

  function mixer() {
    const group = new T.Group();
    scene.add(group);
    casework(group, 2.45, mixerMetal);
    mark(group, 'PS-02', 0, -1.91, 0.221, '#eae7dc', 0.282, 'center', '700', 'sans-serif');
    mark(group, 'STEREO MIXER', 0, -1.72, 0.095, '#d8d1c5');
    mark(group, 'A', -0.74, -1.52, 0.15, '#ffac80');
    mark(group, 'B', 0.74, -1.52, 0.15, '#a3baff');
    for (const x of [-0.451, 0.451])
      box(group, 0.01, 0.004, 1.86, x, 0.281, -0.585, material(0x75766e));

    for (const side of [0, 1] as const) {
      const x = side ? 0.74 : -0.74;
      const deck = engine.decks[side];
      const channelKnob = (key: ChannelControl, z: number, caption: string, color: number, offset = 0, indicator?: number) => {
        const spec = channelControls[key];
        knob(group, x + offset, z, caption, color, () => (deck.controls[key] - spec.min) / (spec.max - spec.min), v => engine.setChannel(side, key, range(v, spec.min, spec.max)), (spec.initial - spec.min) / (spec.max - spec.min), indicator);
      };
      channelKnob('gain', -1.24, 'TRIM', ink, 0, side ? blue : orange);
      channelKnob('high', -0.76, 'HI', ivory);
      channelKnob('mid', -0.28, 'MID', ivory);
      channelKnob('low', 0.2, 'LO', ivory);
      channelKnob('hp', 0.68, 'HP', ink, -0.218);
      channelKnob('lp', 0.68, 'LP', ink, 0.218);
      fader(group, x, 1.42, 0.65, side ? 'CH B' : 'CH A', side ? blue : orange, () => deck.controls.volume, v => engine.setChannel(side, 'volume', v), channelControls.volume.initial);
    }

    for (const channel of [0, 1] as const) {
      const leds: T.MeshStandardMaterial[] = [];
      const meterX = channel ? 0.15 : -0.15;
      mark(group, channel ? 'R' : 'L', meterX, -0.19, 0.102, '#eae7dc');
      box(group, 0.124, 0.03, 0.79, meterX, 0.287, -0.65, rubber, 0.018);
      for (let i = 0; i < 10; i++) {
        const color = i > 8 ? 0xff6032 : i > 6 ? 0xf5c464 : mint;
        const led = new T.MeshStandardMaterial({ color: 0x4a504a, emissive: color, emissiveIntensity: 0 });
        leds.push(led);
        box(group, 0.071, 0.025, 0.042, meterX, 0.312, -0.326 - i * 0.069, led, 0.008);
      }
      let rms = 0, peakAt = 0, lastSample = performance.now();
      animated.push(() => {
        const now = performance.now();
        const level = engine.masterLevels(channel);
        const target = clamp((20 * Math.log10(level.rms || 0.0001) + 40) / 40);
        rms = Math.max(target, rms - (now - lastSample) / 280);
        lastSample = now;
        if (level.peak > 0.98) peakAt = now + 520;
        leds.forEach((led, i) => led.emissiveIntensity = i === 9 ? Number(peakAt > now) * 2 : rms * 9 > i ? 1.6 : 0);
      });
    }
    knob(group, 0, -1.34, 'MASTER', ink, () => engine.master, v => engine.setMix('master', v), mixDefaults.master, yellow);
    display(group, 0, 0.03, 0.64, 0.30, ctx => {
      const state = engine.decks.map(deck => deck.effect).join(':');
      if (ctx.canvas.dataset.state === state) return state;
      ctx.canvas.dataset.state = state;
      ctx.fillStyle = '#151d1a';
      ctx.fillRect(0, 0, 650, 190);
      ctx.font = 'bold 61px monospace';
      for (const side of [0, 1] as const) {
        ctx.fillStyle = side ? '#a5bdff' : '#f4c49c';
        ctx.fillText(`${side ? 'B' : 'A'} / ${effectLabels[effects.indexOf(engine.decks[side].effect)].toUpperCase()}`, 26, 74 + 77 * side, 598);
      }
      return state;
    });
    for (const side of [0, 1] as const) {
      const x = side ? 0.195 : -0.195;
      const deck = engine.decks[side];
      knob(group, x, 0.49, side ? 'FX B' : 'FX A', ink,
        () => effects.indexOf(deck.effect) / (effects.length - 1), v => engine.setEffect(side, Math.round(v * (effects.length - 1))), 0, side ? blue : orange);
      if (engine.canMonitor) button(group, x, 1, 0.28, 'PFL', ink, { label: `Headphone cue · ${side ? 'B' : 'A'}`, press: () => options.monitor(side) }, () => deck.monitoring);
    }
    if (typeof MediaRecorder !== 'undefined') button(group, 0, 1.41, 0.34, 'REC', ink, { label: 'Record mix', press: options.record }, () => engine.recording);
    fader(group, 0, 2.155, 1.35, 'A  ◀  MIX  ▶  B', ivory, () => (engine.cross + 1) / 2, v => engine.setMix('cross', range(v, -1, 1)), (mixDefaults.cross + 1) / 2, true);
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
        if (tooltip) tooltip.textContent = action?.reset ? `${action.label} · double-click to reset` : action?.label || '';
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
    } else transition = undefined;
  }, { passive: false, capture: true, signal });
  let transition: { camera: T.Vector3; target: T.Vector3; from: T.Vector3; fromTarget: T.Vector3; started: number } | undefined;
  let lastView: View = 'studio';
  function framing(view: View) {
    const mobile = narrow();
    const sides = view === 'a' || view === 'b';
    const x = sides ? deckX[view === 'b' ? 1 : 0] : 0;
    const focus = view === 'crate' ? -3.30 : sides || view === 'mixer' ? 0.14 : -0.58;
    const eye = view === 'overhead' ? [0, mobile ? 22 : 12.7, focus + 0.035]
      : view === 'crate' ? [0, mobile ? 9.9 : 5.1, 3.9]
      : view === 'mixer' ? [0, 5.85, 2.65]
      : sides ? [x + (view === 'a' ? -1.0 : 1.0), 5.5, 4.9]
      : [0.04, mobile ? 14.4 : 8.4, mobile ? 15.0 : 8.7];
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
