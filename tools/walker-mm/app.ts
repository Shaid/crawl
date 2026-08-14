/**
 * MM1 + MM2 first-person maze walkers.
 *
 * One page, two games. Both share the ASM-faithful frustum engine
 * (`maze3d.ts`); the art sources differ:
 *
 *   MM1 — the REAL WALLPIX.DTA wall sets (17 entries × 12 frustum slices,
 *   `public/assets/mm1/dosega/textures/wallpix.*`). Each screen picks its
 *   wall set from the decoded `.OVR` selection fields (`data/ovr.json`
 *   wallEntries). Torch overlays use the MM2 torch sheets as stand-ins
 *   (the same choice Vairn's MM1 walker made — MM1 WALLPIX has no torch
 *   frames).
 *
 *   MM2 — the authentic `.32` sheets per environment (town/cave/castle
 *   wall + floor + torch + sky). Indoor screens render the full frustum
 *   with floor/sky bands and flickering torches; overland screens show a
 *   placeholder (their pages are terrain-id encoded — the horizon
 *   renderer is future work).
 *
 * Controls: WASD/arrows move, Q/E turn, N toggles noclip, Tab zooms the
 * minimap. Screen selector + wall-set override in the toolbar.
 */
import {
  VIEW_W,
  VIEW_H,
  ORIGIN_X,
  SKY_Y,
  FLOOR_Y,
  MAP_GRID,
  MAP_PAGE_SIZE,
  buildIndoorScene,
  stepParty,
  torchBlitFor,
  wallpixSliceName,
  StitchedVisual,
  type Pose,
} from './maze3d.ts';

const SCREEN_W = 320;
const SCREEN_H = 200;
const SCALE = 3;

// ──────────────────────────────────────────────────────────────────────────
// Asset loading helpers
// ──────────────────────────────────────────────────────────────────────────

interface AtlasFrame {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

interface Sheet {
  img: HTMLImageElement;
  frames: AtlasFrame[];
  frame(name: string | number): AtlasFrame | undefined;
}

async function loadSheet(png: string, json: string): Promise<Sheet> {
  const [img, sidecar] = await Promise.all([
    loadImage(png),
    fetch(json).then((r) => r.json()),
  ]);
  const frames: AtlasFrame[] = sidecar.frames as AtlasFrame[];
  return {
    img,
    frames,
    frame(name: string | number) {
      const key = String(name);
      return frames.find((f) => f.name === key || f.name.endsWith(`frame${key}`));
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Game data models
// ──────────────────────────────────────────────────────────────────────────

interface MmScreen {
  index: number;
  label: string;
  env: string;
  outdoor: boolean;
  visual: Uint8Array;
  collision: Uint8Array;
  neighbors: number[];
  roofBits?: Uint8Array;
  /** MM1: WALLPIX entry used for the frustum walls. */
  wallEntry: number;
}

interface Mm1Data {
  game: 'mm1';
  screens: MmScreen[];
  wallpix: Sheet;
  torchSheets: Record<string, Sheet>;
  wallSets: string[];
}

interface Mm2Data {
  game: 'mm2';
  screens: MmScreen[];
  walls: Record<string, Sheet>;
  floors: Record<string, Sheet>;
  torches: Record<string, Sheet>;
  sky: Sheet;
}

type GameData = Mm1Data | Mm2Data;

interface CellJson {
  visual: { n: number; e: number; s: number; w: number };
  collision: { n: number; e: number; s: number; w: number };
  event: boolean;
}

/** Reconstruct the raw page bytes from the decoded cell JSON (byte-exact inverse of the codecs). */
function pagesFromCells(cells: CellJson[][]): { visual: Uint8Array; collision: Uint8Array } {
  const visual = new Uint8Array(MAP_PAGE_SIZE);
  const collision = new Uint8Array(MAP_PAGE_SIZE);
  for (let y = 0; y < MAP_GRID; y++) {
    for (let x = 0; x < MAP_GRID; x++) {
      const c = cells[y][x];
      const i = y * MAP_GRID + x;
      visual[i] = c.visual.n | (c.visual.e << 2) | (c.visual.s << 4) | (c.visual.w << 6);
      collision[i] =
        (c.collision.n & 3) |
        ((c.collision.e & 3) << 2) |
        ((c.collision.s & 3) << 4) |
        (c.collision.w !== 0 ? 0x40 : 0) |
        (c.event ? 0x80 : 0);
    }
  }
  return { visual, collision };
}

async function loadMm1(): Promise<Mm1Data> {
  const base = '/assets/mm1/dosega';
  const [mapsJson, ovrJson, wallpix] = await Promise.all([
    fetch(`${base}/data/maps.json`).then((r) => r.json()),
    fetch(`${base}/data/ovr.json`).then((r) => r.json()),
    loadSheet(`${base}/textures/wallpix.png`, `${base}/textures/wallpix.json`),
  ]);
  const torchNames = ['town', 'cave', 'castle'];
  const torchSheets: Record<string, Sheet> = {};
  for (const t of torchNames) {
    torchSheets[t] = await loadSheet(
      `/assets/mm2/amiga/textures/${t}t.png`,
      `/assets/mm2/amiga/textures/${t}t.json`,
    );
  }
  const screens: MmScreen[] = mapsJson.screens.map((s: { index: number; slug: string; title: string; env: string; cells: CellJson[][] }) => {
    const { visual, collision } = pagesFromCells(s.cells);
    const ovr = ovrJson.overlays.find((o: { slug: string }) => o.slug === s.slug);
    return {
      index: s.index,
      label: `${s.index}: ${s.title}`,
      env: s.env,
      outdoor: s.env === 'outside',
      visual,
      collision,
      neighbors: [-1, -1, -1, -1],
      wallEntry: ovr && ovr.wallEntries ? (ovr.wallEntries[0] as number) : 0,
    };
  });
  return {
    game: 'mm1',
    screens,
    wallpix,
    torchSheets,
    wallSets: Array.from({ length: 17 }, (_, i) => `wall ${String(i).padStart(2, '0')}`),
  };
}

const MM2_ENV_BY_RANGE: Array<[number, number, string, boolean]> = [
  [0, 4, 'town', false],
  [5, 16, 'outside', true],
  [17, 32, 'cavern', false],
  [33, 44, 'outside', true],
  [45, 59, 'castle', false],
];

async function loadMm2(): Promise<Mm2Data> {
  const base = '/assets/mm2/amiga';
  const [mapJson, attribJson] = await Promise.all([
    fetch(`${base}/data/map.json`).then((r) => r.json()),
    fetch(`${base}/data/attrib.json`).then((r) => r.json()),
  ]);
  const envFor = (i: number): [string, boolean] => {
    for (const [lo, hi, env, outdoor] of MM2_ENV_BY_RANGE) {
      if (i >= lo && i <= hi) return [env, outdoor];
    }
    return ['town', false];
  };
  const sheets = ['town', 'cave', 'castle'];
  const [walls, floors, torches, sky] = await Promise.all([
    Promise.all(sheets.map((s) => loadSheet(`${base}/textures/${s}.png`, `${base}/textures/${s}.json`))),
    Promise.all(sheets.map((s) => loadSheet(`${base}/textures/${s}f.png`, `${base}/textures/${s}f.json`))),
    Promise.all(sheets.map((s) => loadSheet(`${base}/textures/${s}t.png`, `${base}/textures/${s}t.json`))),
    loadSheet(`${base}/textures/sky.png`, `${base}/textures/sky.json`),
  ]);
  const screens: MmScreen[] = (mapJson as { index: number; cells: CellJson[][] }[]).map((s, i) => {
    const { visual, collision } = pagesFromCells(s.cells);
    const [env, outdoor] = envFor(i);
    const attrib = attribJson[i];
    const roofBits =
      attrib && attrib.roofBits
        ? Uint8Array.from(Object.values(attrib.roofBits as Record<string, number>))
        : undefined;
    return {
      index: s.index,
      label: `screen ${s.index} (${env})`,
      env,
      outdoor,
      visual,
      collision,
      neighbors: attrib ? (attrib.neighbours as number[]) : [-1, -1, -1, -1],
      roofBits,
      wallEntry: 0,
    };
  });
  return {
    game: 'mm2',
    screens,
    walls: Object.fromEntries(sheets.map((s, i) => [s, walls[i]])),
    floors: Object.fromEntries(sheets.map((s, i) => [s, floors[i]])),
    torches: Object.fromEntries(sheets.map((s, i) => [s, torches[i]])),
    sky,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Minimap
// ──────────────────────────────────────────────────────────────────────────

function drawMinimap(ctx: CanvasRenderingContext2D, sc: MmScreen, pose: Pose, zoomed: boolean): void {
  const size = zoomed ? 224 : 112;
  const cell = size / MAP_GRID;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#141420';
  ctx.fillRect(0, 0, size, size);
  const wallW = Math.max(1, Math.floor(cell / 5));
  ctx.fillStyle = '#c8c8d0';
  for (let y = 0; y < MAP_GRID; y++) {
    for (let x = 0; x < MAP_GRID; x++) {
      const v = sc.visual[y * MAP_GRID + x];
      const nib = (dir: number) => (v >> (dir * 2)) & 3;
      const px = x * cell;
      const py = y * cell;
      // Field->edge mapping matches the view's facing convention: facing 0
      // (move +y, minimap down) blocks on collision field 3, so field 3 sits
      // on the bottom edge; 1 -> top, 2 -> right, 0 -> left.
      if (nib(0) !== 0) ctx.fillRect(px, py, wallW, cell); // left
      if (nib(1) !== 0) ctx.fillRect(px, py, cell, wallW); // top
      if (nib(2) !== 0) ctx.fillRect(px + cell - wallW, py, wallW, cell); // right
      if (nib(3) !== 0) ctx.fillRect(px, py + cell - wallW, cell, wallW); // bottom
    }
  }
  // player
  const px = pose.x * cell + cell / 2;
  const py = pose.y * cell + cell / 2;
  ctx.fillStyle = '#ff3030';
  ctx.beginPath();
  ctx.arc(px, py, Math.max(2, cell / 5), 0, Math.PI * 2);
  ctx.fill();
  const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const [dx, dy] = dirs[pose.facing & 3];
  ctx.strokeStyle = '#ff3030';
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(px + dx * cell * 0.4, py + dy * cell * 0.4);
  ctx.stroke();
}

// ──────────────────────────────────────────────────────────────────────────
// Renderers
// ──────────────────────────────────────────────────────────────────────────

/** MM1: frustum frame -> WALLPIX slice name for `entry`. */
function mm1SliceName(entry: number, frame: number): string {
  return wallpixSliceName(entry, frame);
}

function sheetKeyFor(env: string): string {
  return env === 'cavern' ? 'cave' : env === 'castle' ? 'castle' : 'town';
}

function renderMm1(ctx: CanvasRenderingContext2D, data: Mm1Data, sc: MmScreen, pose: Pose, phase: number): void {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  // dark floor band for readability
  ctx.fillStyle = '#181818';
  ctx.fillRect(ORIGIN_X, FLOOR_Y, VIEW_W - ORIGIN_X * 2, VIEW_H - FLOOR_Y);

  const grid = new StitchedVisual(data.screens, pose.screen);
  const scene = buildIndoorScene(grid, pose.x, pose.y, pose.facing);
  const torchSheet = data.torchSheets[sheetKeyFor(sc.env)] ?? data.torchSheets.cave;

  for (const b of scene.blits) {
    const name = mm1SliceName(sc.wallEntry, b.frame);
    const fr = data.wallpix.frame(name);
    if (!fr) continue;
    ctx.drawImage(data.wallpix.img, fr.x, fr.y, fr.w, fr.h, b.x, b.y, fr.w, fr.h);
  }
  for (const b of scene.torchBlits) {
    const tb = torchBlitFor(b, phase);
    if (!tb) continue;
    const fr = torchSheet.frame(tb.frame);
    if (!fr) continue;
    ctx.drawImage(torchSheet.img, fr.x, fr.y, fr.w, fr.h, tb.x, tb.y, fr.w, fr.h);
  }
}

function renderMm2(ctx: CanvasRenderingContext2D, data: Mm2Data, sc: MmScreen, pose: Pose, phase: number): void {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  if (sc.outdoor) {
    ctx.fillStyle = '#202028';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = '#888';
    ctx.font = '14px monospace';
    ctx.fillText('overland renderer pending', ORIGIN_X + 20, 60);
    ctx.fillText('(use the minimap)', ORIGIN_X + 20, 80);
    return;
  }
  const env = sheetKeyFor(sc.env);
  const walls = data.walls[env];
  const floor = data.floors[env];
  const torch = data.torches[env];

  const skyFrame = sc.roofBits && (sc.roofBits[(pose.y * MAP_GRID + pose.x) >> 3] & (1 << ((pose.y * MAP_GRID + pose.x) & 7))) ? 1 : 0;
  const ffloor = floor.frame('0');
  const fsky = data.sky.frame(String(skyFrame));
  if (ffloor) ctx.drawImage(floor.img, ffloor.x, ffloor.y, ffloor.w, ffloor.h, ORIGIN_X, FLOOR_Y, ffloor.w, ffloor.h);
  if (fsky) ctx.drawImage(data.sky.img, fsky.x, fsky.y, fsky.w, fsky.h, ORIGIN_X, SKY_Y, fsky.w, fsky.h);

  const grid = new StitchedVisual(data.screens, pose.screen);
  const scene = buildIndoorScene(grid, pose.x, pose.y, pose.facing);
  for (const b of scene.blits) {
    const fr = walls.frame(b.frame);
    if (!fr) continue;
    ctx.drawImage(walls.img, fr.x, fr.y, fr.w, fr.h, b.x, b.y, fr.w, fr.h);
  }
  for (const b of scene.torchBlits) {
    const tb = torchBlitFor(b, phase);
    if (!tb) continue;
    const fr = torch.frame(tb.frame);
    if (!fr) continue;
    ctx.drawImage(torch.img, fr.x, fr.y, fr.w, fr.h, tb.x, tb.y, fr.w, fr.h);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// App shell
// ──────────────────────────────────────────────────────────────────────────

interface AppState {
  game: 'mm1' | 'mm2';
  data: GameData;
  pose: Pose;
  noclip: boolean;
  wallOverride: number | null;
}

const els = {
  game: document.getElementById('game') as HTMLSelectElement,
  screen: document.getElementById('screen') as HTMLSelectElement,
  wallset: document.getElementById('wallset') as HTMLSelectElement,
  noclip: document.getElementById('noclip') as HTMLInputElement,
  status: document.getElementById('status') as HTMLSpanElement,
  view: document.getElementById('view') as HTMLCanvasElement,
  minimap: document.getElementById('minimap') as HTMLCanvasElement,
};

const viewCtx = els.view.getContext('2d')!;
const miniCtx = els.minimap.getContext('2d')!;

els.view.width = SCREEN_W * SCALE;
els.view.height = SCREEN_H * SCALE;

let state: AppState | null = null;
let torchPhase = 0;
let zoomed = false;
const keys = new Set<string>();

function screenFor(state: AppState): MmScreen {
  return state.data.screens[state.pose.screen];
}

function currentWallEntry(state: AppState): number {
  if (state.game === 'mm1') {
    const sc = screenFor(state);
    return state.wallOverride ?? sc.wallEntry;
  }
  return 0;
}

function render(): void {
  if (!state) return;
  const sc = screenFor(state);
  viewCtx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  if (state.game === 'mm1') {
    renderMm1(viewCtx, state.data as Mm1Data, sc, state.pose, torchPhase);
  } else {
    renderMm2(viewCtx, state.data as Mm2Data, sc, state.pose, torchPhase);
  }
  drawMinimap(miniCtx, sc, state.pose, zoomed);
  els.status.textContent = `${sc.label} · (${state.pose.x},${state.pose.y}) facing ${['N', 'E', 'S', 'W'][state.pose.facing & 3]} · wall ${currentWallEntry(state)}`;
}

function setPose(pose: Pose): void {
  if (!state) return;
  state.pose = pose;
  els.screen.value = String(pose.screen);
  render();
}

function move(facingDelta: number): void {
  if (!state) return;
  const next = stepParty(
    (state.pose.facing + facingDelta) & 3,
    state.pose.x,
    state.pose.y,
    state.pose.screen,
    state.data.screens,
    state.noclip,
  );
  if (facingDelta === 0 && next.screen === state.pose.screen && next.x === state.pose.x && next.y === state.pose.y) return;
  setPose(next);
}

function selectGame(game: 'mm1' | 'mm2'): void {
  const loader = game === 'mm1' ? loadMm1 : loadMm2;
  els.status.textContent = 'loading…';
  loader().then((data) => {
    const first = data.screens.find((s) => !s.outdoor) ?? data.screens[0];
    state = {
      game,
      data,
      pose: { screen: first.index, x: 8, y: 8, facing: 0 },
      noclip: els.noclip.checked,
      wallOverride: null,
    };
    // find a walkable cell
    const sc = data.screens[first.index];
    for (let y = 0; y < MAP_GRID; y++) {
      for (let x = 0; x < MAP_GRID; x++) {
        const c = sc.collision[y * MAP_GRID + x];
        const blocked = (c & 1) || ((c >> 2) & 1) || ((c >> 4) & 1) || (c & 0x40);
        if (!blocked) {
          state.pose = { screen: first.index, x, y, facing: 0 };
          break;
        }
      }
    }
    els.screen.innerHTML = '';
    for (const s of data.screens) {
      const opt = document.createElement('option');
      opt.value = String(s.index);
      opt.textContent = s.label;
      els.screen.appendChild(opt);
    }
    els.screen.value = String(state.pose.screen);
    if (game === 'mm1') {
      els.wallset.style.display = '';
      els.wallset.innerHTML = '<option value="auto">auto</option>' +
        (data as Mm1Data).wallSets.map((w, i) => `<option value="${i}">${w}</option>`).join('');
      els.wallset.value = 'auto';
    } else {
      els.wallset.style.display = 'none';
    }
    render();
  }).catch((e) => {
    els.status.textContent = `load failed: ${e}`;
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Events
// ──────────────────────────────────────────────────────────────────────────

els.game.addEventListener('change', () => selectGame(els.game.value as 'mm1' | 'mm2'));
els.screen.addEventListener('change', () => {
  if (!state) return;
  const sc = state.data.screens[Number(els.screen.value)];
  state.pose = { screen: sc.index, x: 8, y: 8, facing: 0 };
  render();
});
els.wallset.addEventListener('change', () => {
  if (!state || state.game !== 'mm1') return;
  const v = els.wallset.value;
  state.wallOverride = v === 'auto' ? null : Number(v);
  render();
});
els.noclip.addEventListener('change', () => {
  if (state) state.noclip = els.noclip.checked;
});

window.addEventListener('keydown', (e) => {
  if (keys.has(e.key)) return;
  keys.add(e.key);
  if (!state) return;
  switch (e.key) {
    case 'w': case 'W': case 'ArrowUp': move(0); break;
    case 's': case 'S': case 'ArrowDown': move(2); break;
    case 'q': case 'Q': case 'ArrowLeft': move(3); break;
    case 'e': case 'E': case 'ArrowRight': move(1); break;
    case 'n': case 'N': els.noclip.checked = !els.noclip.checked; if (state) state.noclip = els.noclip.checked; break;
    case 'Tab': zoomed = !zoomed; render(); e.preventDefault(); break;
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.key));

// torch flicker + slow minimap-only re-render when idle
let lastTick = 0;
function tick(t: number): void {
  if (t - lastTick > 120) {
    torchPhase = (torchPhase + 1) % 3;
    if (state) render();
    lastTick = t;
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

selectGame('mm1');

// Debug hook for headless verification.
(window as unknown as { __mmWalker: () => unknown }).__mmWalker = () => ({
  state: state ? { game: state.game, pose: state.pose, noclip: state.noclip, wallOverride: state.wallOverride } : null,
  screenOptions: [...els.screen.options].map((o) => o.textContent),
});
