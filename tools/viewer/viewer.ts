import { setHidden, type AtlasMeta, type PaletteData, type AtlasFrame, type AssetGroup, type GroupsFile } from './shared.ts';
import { renderDataTable } from './data-table.ts';
import {
  downloadScreenshot,
  recordClip,
  downloadClip,
  createPopover,
  buildGradingFilterString,
  type CaptureSource,
  type RecordClipDriver,
  type GradingOptions,
} from '@seer-project/canvas-export';
import {
  createRetroDisplayRenderer,
  resolveRetroDisplayOptions,
  type DisplayProfile,
  type RetroDisplayOptions,
  type RetroDisplayRenderer,
} from '@seer-project/retro-display';
import { getAssetBasePath, getViewerConfig } from '../shared/viewer-config.ts';
import {
  DEFAULT_GAME,
  DEFAULT_PLATFORM,
  GAME_DISPLAY_NAMES,
  GAME_IDS,
  isGameId,
  isPlatformId,
  PLATFORM_DISPLAY_NAMES,
  type GameId,
  type PlatformId,
} from '../../src/game-id.ts';

interface ManifestEntry {
  name: string;
  sprites: number;
  hasPalette: boolean;
  png: string;
  groupsFile?: string;
  /** 'data' entries are JSON tables rendered by renderDataTable, not atlases. */
  kind?: 'atlas' | 'data';
  /** JSON path relative to the asset base; defaults to `${name}.json`. */
  data?: string;
  /** Explicit atlas sidecar path (w6-style manifests); defaults to `${name}.json`. */
  atlas?: string;
  /** Explicit palette path (w6-style manifests); defaults to `${name}.pal.json` when hasPalette. */
  palette?: string;
}

const listEl = document.getElementById('list')!;
const listMetaEl = document.getElementById('list-meta')!;
const searchEl = document.getElementById('search') as HTMLInputElement;
const titleEl = document.getElementById('title')!;
const metaEl = document.getElementById('meta')!;
const frameInfoEl = document.getElementById('frame-info')!;
const canvasWrap = document.getElementById('canvas-wrap')!;
const zoomEl = document.getElementById('zoom') as HTMLSelectElement;
const bgEl = document.getElementById('bg') as HTMLSelectElement;
const frameStrip = document.getElementById('frame-strip')!;
const frameSlider = document.getElementById('frame-slider') as HTMLInputElement;
const frameLabel = document.getElementById('frame-label')!;
const playToggleEl = document.getElementById('play-toggle') as HTMLButtonElement;
const paletteBar = document.getElementById('palette-bar')!;
const gameSelectEl = document.getElementById('game-select') as HTMLSelectElement;
const platformSelectEl = document.getElementById('platform-select') as HTMLSelectElement;
const spriteScreenshotBtn = document.getElementById('sprite-screenshot') as HTMLButtonElement;
const spriteRecordBtn = document.getElementById('sprite-record') as HTMLButtonElement;
const spriteDisplayToggle = document.getElementById('sprite-display-toggle') as HTMLButtonElement;
const spriteDisplayPanel = document.getElementById('sprite-display-panel')!;
const displayProfileEl = document.getElementById('display-profile') as HTMLSelectElement;
const displayScanlineEl = document.getElementById('display-scanline') as HTMLInputElement;
const displayMaskEl = document.getElementById('display-mask') as HTMLInputElement;
const displayCurvatureEl = document.getElementById('display-curvature') as HTMLInputElement;
const displayVignetteEl = document.getElementById('display-vignette') as HTMLInputElement;
const displayGlowEl = document.getElementById('display-glow') as HTMLInputElement;
const displayChromaticEl = document.getElementById('display-chromatic') as HTMLInputElement;
const gradingBrightnessEl = document.getElementById('grading-brightness') as HTMLInputElement;
const gradingContrastEl = document.getElementById('grading-contrast') as HTMLInputElement;
const gradingSaturateEl = document.getElementById('grading-saturate') as HTMLInputElement;
const gradingHueEl = document.getElementById('grading-hue') as HTMLInputElement;
const gradingResetBtn = document.getElementById('grading-reset') as HTMLButtonElement;

let manifest: ManifestEntry[] = [];
let selected: ManifestEntry | null = null;
let currentAtlas: AtlasMeta | null = null;
let currentPalette: PaletteData | null = null;
let currentFrames: AtlasFrame[] = [];
let currentFrame = 0;
/** Colour grading applied via `ctx.filter` in the Canvas2D draw path (Phase 4 of 2d-export-proposal.md) — persists across asset switches, like zoom/background. */
let gradingOptions: GradingOptions = {};
/** Post-display simulation (Phases 5-6) — persists across asset switches. Renderer created lazily (first non-'none' selection) since it opens its own WebGL2 context. */
let displayOptions: RetroDisplayOptions = { profile: 'none' };
let retroDisplayRenderer: RetroDisplayRenderer | null = null;

/** The list as currently filtered/searched — kept in sync by renderList(), used by Up/Down keyboard navigation. */
let currentFilteredList: ManifestEntry[] = [];

// Grouped browsing (`groupsFile`): which top-level entries are expanded in
// the sidebar, their loaded groups data, and which group (if any) is being
// viewed — narrows `currentFrames` to that group's frames instead of the
// whole atlas.
const expandedAssets = new Set<string>();
const groupsCache = new Map<string, GroupsFile>();
let selectedGroup: AssetGroup | null = null;

let currentGame: GameId = DEFAULT_GAME;
let currentPlatform: PlatformId = DEFAULT_PLATFORM;
let assetBase = getAssetBasePath(currentGame, currentPlatform);

function readGameFromUrl(): GameId {
  const params = new URLSearchParams(window.location.search);
  const game = params.get('game');
  return isGameId(game) ? game : DEFAULT_GAME;
}

function readPlatformFromUrl(): PlatformId {
  const params = new URLSearchParams(window.location.search);
  const platform = params.get('platform');
  return isPlatformId(platform) ? platform : DEFAULT_PLATFORM;
}

function updatePageTitle() {
  const config = getViewerConfig(currentGame);
  const gameLabel = config.name;
  const hasPlatform = config.supportedPlatforms.includes(currentPlatform);
  const platformLabel = hasPlatform ? PLATFORM_DISPLAY_NAMES[currentPlatform] : '';
  document.title = platformLabel ? `${gameLabel} · ${platformLabel} — Asset Viewer` : `${gameLabel} — Asset Viewer`;
}

function populateGameSelect() {
  gameSelectEl.innerHTML = '';
  for (const id of GAME_IDS) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = GAME_DISPLAY_NAMES[id];
    gameSelectEl.appendChild(opt);
  }
  gameSelectEl.value = currentGame;
}

function populatePlatformSelect() {
  const platforms = getViewerConfig(currentGame).supportedPlatforms;
  platformSelectEl.innerHTML = '';
  for (const id of platforms) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = PLATFORM_DISPLAY_NAMES[id];
    platformSelectEl.appendChild(opt);
  }
  if (platforms.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '(no assets yet)';
    opt.disabled = true;
    platformSelectEl.appendChild(opt);
  }
  if (platforms.includes(currentPlatform)) {
    platformSelectEl.value = currentPlatform;
  }
}

function resetSelection() {
  selected = null;
  currentAtlas = null;
  currentPalette = null;
  currentFrames = [];
  currentFrame = 0;
  selectedGroup = null;
  stopPlayback();
  titleEl.textContent = 'No asset selected';
  metaEl.textContent = '';
  frameInfoEl.textContent = '';
  setHidden(frameStrip, true);
  setHidden(spriteDisplayToggle, true);
  paletteBar.innerHTML = '';
  canvasWrap.innerHTML = '<div class="state-panel"><span class="state-icon">🖼</span><span class="state-title">Select an asset</span></div>';
}

function showListEmpty(message: string, detail?: string) {
  listEl.innerHTML = `<div class="no-results"><p>${message}</p>${detail ? `<p style="margin-top:8px;font-size:11px;">${detail}</p>` : ''}</div>`;
  listMetaEl.textContent = '0 assets';
}

async function loadManifest(): Promise<void> {
  const config = getViewerConfig(currentGame);
  assetBase = getAssetBasePath(currentGame, currentPlatform);
  updatePageTitle();
  resetSelection();

  if (config.supportedPlatforms.length === 0) {
    manifest = [];
    showListEmpty(
      'No extracted assets for this game yet.',
      'Register a platform + extractor in <code>tools/shared/game-config.ts</code> (or <code>scripts/</code>) and run <code>npm run build-assets</code>.',
    );
    return;
  }

  expandedAssets.clear();
  groupsCache.clear();

  try {
    const res = await fetch(`${assetBase}/manifest.json`);
    if (!res.ok) throw new Error('Manifest not found');
    manifest = await res.json();
  } catch {
    manifest = [];
    showListEmpty(
      'No assets found.',
      'Run <code>npm run build-assets</code> first.',
    );
    return;
  }
  renderList();
}

async function loadJSON<T>(name: string): Promise<T | null> {
  try {
    const res = await fetch(`${assetBase}/${name}`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

function renderList() {
  const q = searchEl.value.trim().toLowerCase();
  const filtered = q ? manifest.filter(a => a.name.includes(q)) : manifest;
  currentFilteredList = filtered;

  listMetaEl.textContent = `${filtered.length} of ${manifest.length} assets`;

  listEl.innerHTML = '';
  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'no-results';
    empty.textContent = 'No matching assets.';
    listEl.appendChild(empty);
    return;
  }

  for (const a of filtered) {
    const item = document.createElement('div');
    item.className = 'item';
    if (selected === a && !selectedGroup) item.classList.add('selected');
    const caret = a.groupsFile ? `<span class="item-caret">${expandedAssets.has(a.name) ? '▾' : '▸'}</span>` : '';
    const kindTag = a.kind === 'data' ? `<span class="tag">data</span>` : '';
    item.innerHTML = `${caret}<span class="item-label">${a.name}</span>${kindTag}<span class="item-dim">${a.kind === 'data' ? '' : `${a.sprites}sp${a.hasPalette ? ' · pal' : ''}`}</span>`;
    item.addEventListener('click', () => {
      if (a.groupsFile) toggleExpanded(a);
      else selectAsset(a);
    });
    listEl.appendChild(item);

    if (a.groupsFile && expandedAssets.has(a.name)) {
      const groupsData = groupsCache.get(a.name);
      if (!groupsData) {
        const loading = document.createElement('div');
        loading.className = 'item-group loading';
        loading.textContent = 'Loading groups…';
        listEl.appendChild(loading);
      } else {
        for (const g of groupsData.groups) {
          const gEl = document.createElement('div');
          gEl.className = 'item item-group';
          if (selected === a && selectedGroup === g) gEl.classList.add('selected');
          gEl.innerHTML = `<span class="item-label">${g.name}</span><span class="item-dim">${g.frames.length}</span>`;
          gEl.addEventListener('click', (e) => {
            e.stopPropagation();
            selectGroup(a, groupsData, g);
          });
          listEl.appendChild(gEl);
        }
      }
    }
  }
}

async function toggleExpanded(asset: ManifestEntry) {
  if (expandedAssets.has(asset.name)) {
    expandedAssets.delete(asset.name);
    renderList();
    return;
  }
  expandedAssets.add(asset.name);
  renderList();
  if (asset.groupsFile && !groupsCache.has(asset.name)) {
    const data = await loadJSON<GroupsFile>(asset.groupsFile);
    if (data) groupsCache.set(asset.name, data);
    renderList();
  }
  // Show the full atlas as an overview alongside the expanded group list.
  if (selected !== asset) await selectAsset(asset, { keepGroup: false });
}

async function selectAsset(asset: ManifestEntry, opts: { keepGroup?: boolean } = {}) {
  selected = asset;
  currentFrame = 0;
  stopPlayback();
  if (!opts.keepGroup) selectedGroup = null;
  if (asset.kind === 'data') {
    currentAtlas = null;
    currentPalette = null;
    currentFrames = [];
    const json = await loadJSON<unknown>(asset.data ?? `${asset.name}.json`);
    renderList();
    drawData(asset, json);
    return;
  }
  currentAtlas = await loadJSON<AtlasMeta>(asset.atlas ?? `${asset.name}.json`);
  currentPalette = asset.palette ? await loadJSON<PaletteData>(asset.palette)
    : asset.hasPalette ? await loadJSON<PaletteData>(`${asset.name}.pal.json`) : null;
  const allFrames = currentAtlas?.frames ?? [];
  if (selectedGroup) {
    const byName = new Map(allFrames.map(f => [f.name, f]));
    currentFrames = selectedGroup.frames.map(n => byName.get(n)).filter((f): f is AtlasFrame => !!f);
  } else {
    currentFrames = allFrames;
  }
  // Primed here, once per asset, so drawAsset() -> drawSpriteFrame()/
  // drawFullAtlas() below can stay fully synchronous for every subsequent
  // redraw of THIS asset (frame nav, zoom change, autoplay tick).
  await loadCachedAtlasImage(`${assetBase}/${asset.png || `${asset.name}.png`}`);
  renderList();
  drawAsset();
}

async function selectGroup(asset: ManifestEntry, _groupsData: GroupsFile, group: AssetGroup) {
  selectedGroup = group;
  stopPlayback();
  if (selected === asset && currentAtlas) {
    const byName = new Map(currentAtlas.frames.map(f => [f.name, f]));
    currentFrames = group.frames.map(n => byName.get(n)).filter((f): f is AtlasFrame => !!f);
    currentFrame = 0;
    renderList();
    drawAsset();
  } else {
    await selectAsset(asset, { keepGroup: true });
  }
}

async function navigateList(delta: 1 | -1): Promise<void> {
  if (currentFilteredList.length === 0) return;
  const currentIndex = selected ? currentFilteredList.indexOf(selected) : -1;
  const nextIndex =
    currentIndex === -1
      ? 0
      : (currentIndex + delta + currentFilteredList.length) % currentFilteredList.length;
  await selectAsset(currentFilteredList[nextIndex]!);
  listEl.querySelector('.item.selected')?.scrollIntoView({ block: 'nearest' });
}

function frameLabel_(asset: ManifestEntry, frame: AtlasFrame): string | null {
  const data = groupsCache.get(asset.name);
  return data?.frameLabels?.[frame.name] ?? null;
}

function drawData(asset: ManifestEntry, json: unknown) {
  titleEl.textContent = asset.name;
  metaEl.textContent = describeData(json);
  frameInfoEl.textContent = '';
  setHidden(frameStrip, true);
  paletteBar.innerHTML = '';
  setHidden(paletteBar, true);
  if (json === null) {
    canvasWrap.innerHTML = '<div class="state-panel state-error"><span class="state-icon">⚠</span><span class="state-title">Failed to load data JSON</span></div>';
    return;
  }
  canvasWrap.innerHTML = `<div class="data-wrap">${renderDataTable(json)}</div>`;
}

function describeData(json: unknown): string {
  if (Array.isArray(json)) return `${json.length} rows`;
  if (typeof json === 'object' && json !== null) {
    const keys = Object.keys(json);
    return `${keys.length} sections`;
  }
  return 'data';
}

// ── Persistent canvas + image cache (Phase 2 of 2d-export-proposal.md) ──
//
// The previous implementation did `canvasWrap.innerHTML = ''` + created a
// BRAND NEW `<canvas>` on every single draw, and re-fetched/re-decoded the
// atlas PNG via a fresh `Image()` on every redraw even though nothing
// about the image itself had changed. That broke `canvas.captureStream()`
// (Phase 3's video export — a `MediaStreamTrack` goes to `ended` on the
// first frame advance if its source element gets replaced) and wasted
// work on every zoom change or frame-nav click.

const spriteCanvas2D = document.createElement('canvas');

/** Makes `canvas` the sole child of `canvasWrap` — a no-op (no DOM mutation) if it already is, so this is cheap to call unconditionally on every redraw. */
function mountSpriteCanvas(canvas: HTMLCanvasElement): void {
  if (canvasWrap.firstElementChild === canvas && canvasWrap.children.length === 1) return;
  canvasWrap.innerHTML = '';
  canvasWrap.appendChild(canvas);
}

/**
 * Post-display simulation (Phases 5-6 of `2d-export-proposal.md`) — called
 * at the end of `drawSpriteFrame`/`drawFullAtlas`, after grading
 * (`ctx.filter`) is already baked into `spriteCanvas2D`. When a profile is
 * active, feeds that already-graded canvas through `retroDisplayRenderer`
 * and mounts ITS output canvas instead. A no-op, leaving `spriteCanvas2D`
 * mounted, when `displayOptions.profile === 'none'`.
 */
function applyRetroDisplayIfActive(): void {
  if (displayOptions.profile === 'none') return;
  retroDisplayRenderer ??= createRetroDisplayRenderer(displayOptions);
  retroDisplayRenderer.setOptions(displayOptions);
  retroDisplayRenderer.render(spriteCanvas2D);
  mountSpriteCanvas(retroDisplayRenderer.canvas);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${url}`));
    img.src = url;
  });
}

/** One-slot cache (plain atlas image) keyed by URL — `selectAsset()`/`selectGroup()` prime this before their final `drawAsset()` call, so every subsequent redraw (zoom change, frame nav) reads an already-decoded bitmap instead of re-fetching. */
let cachedAtlasImage: HTMLImageElement | null = null;
let cachedAtlasImageUrl: string | null = null;

async function loadCachedAtlasImage(url: string): Promise<void> {
  if (cachedAtlasImageUrl === url && cachedAtlasImage) return;
  try {
    cachedAtlasImage = await loadImage(url);
    cachedAtlasImageUrl = url;
  } catch {
    cachedAtlasImage = null;
    cachedAtlasImageUrl = null;
  }
}

function drawAsset() {
  if (!selected || !currentAtlas) {
    setHidden(spriteDisplayToggle, true);
    canvasWrap.innerHTML = '<div class="state-panel"><span class="state-icon">🖼</span><span class="state-title">Select an asset</span></div>';
    return;
  }
  setHidden(spriteDisplayToggle, false);

  const zoom = Number(zoomEl.value);
  const frame = currentFrames[currentFrame];

  if (frame) {
    const groupPrefix = selectedGroup ? `${selectedGroup.name} — ` : '';
    const label = frameLabel_(selected, frame);
    const frameName = label ? `${label} (${frame.name})` : frame.name;
    titleEl.textContent = `${groupPrefix}${frameName} — ${currentFrame + 1}/${currentFrames.length}`;
    metaEl.textContent = `${frame.w}×${frame.h}`;
    frameInfoEl.textContent = `atlas ${currentAtlas.width}×${currentAtlas.height}`;
    setHidden(frameStrip, currentFrames.length <= 1);
    frameSlider.max = String(currentFrames.length - 1);
    frameSlider.value = String(currentFrame);
    frameLabel.textContent = `${currentFrame + 1} / ${currentFrames.length}`;
    // Recording plays through currentFrames — meaningless (and disabled,
    // like the play/pause button already is) for a single-frame asset.
    spriteRecordBtn.disabled = currentFrames.length <= 1;
    spriteRecordBtn.title = currentFrames.length <= 1 ? 'This asset has only one frame' : 'Record a watermarked clip of the sprite animation';

    drawSpriteFrame(frame, zoom);
  } else {
    drawFullAtlas(selected, currentAtlas, zoom);
  }
}

/** Draws one atlas frame into the persistent Canvas2D canvas — synchronous, relying on `selectAsset()`/`selectGroup()` having already primed `cachedAtlasImage` for this asset. Safe to call every autoplay tick/frame-nav/zoom-change. */
function drawSpriteFrame(frame: AtlasFrame, zoom: number): void {
  const url = `${assetBase}/${selected!.png || `${selected!.name}.png`}`;
  if (!cachedAtlasImage || cachedAtlasImageUrl !== url) {
    canvasWrap.innerHTML = '<div class="state-panel state-error"><span class="state-icon">⚠</span><span class="state-title">Failed to load image</span></div>';
    return;
  }

  mountSpriteCanvas(spriteCanvas2D);
  spriteCanvas2D.width = Math.max(1, frame.w * zoom);
  spriteCanvas2D.height = Math.max(1, frame.h * zoom);
  const ctx = spriteCanvas2D.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, spriteCanvas2D.width, spriteCanvas2D.height);
  ctx.filter = buildGradingFilterString(gradingOptions);
  ctx.drawImage(cachedAtlasImage, frame.x, frame.y, frame.w, frame.h, 0, 0, spriteCanvas2D.width, spriteCanvas2D.height);
  ctx.filter = 'none';

  renderPalette(currentPalette);
  applyRetroDisplayIfActive();
}

function drawFullAtlas(asset: ManifestEntry, atlas: AtlasMeta, zoom: number) {
  titleEl.textContent = `${asset.name} — full atlas`;
  metaEl.textContent = `${atlas.width}×${atlas.height}, ${atlas.frames.length} sprites`;
  setHidden(frameStrip, true);

  const url = `${assetBase}/${asset.png || `${asset.name}.png`}`;
  if (!cachedAtlasImage || cachedAtlasImageUrl !== url) {
    canvasWrap.innerHTML = '<div class="state-panel state-error"><span class="state-icon">⚠</span><span class="state-title">Failed to load image</span></div>';
    return;
  }

  mountSpriteCanvas(spriteCanvas2D);
  const cw = Math.max(1, atlas.width * zoom);
  const ch = Math.max(1, atlas.height * zoom);
  spriteCanvas2D.width = cw;
  spriteCanvas2D.height = ch;
  const ctx = spriteCanvas2D.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, cw, ch);
  ctx.filter = buildGradingFilterString(gradingOptions);
  ctx.drawImage(cachedAtlasImage, 0, 0, cw, ch);
  ctx.filter = 'none';

  ctx.strokeStyle = 'rgba(255, 255, 0, 0.5)';
  ctx.lineWidth = 1;
  for (const f of atlas.frames) {
    ctx.strokeRect(f.x * zoom, f.y * zoom, Math.max(1, f.w * zoom), Math.max(1, f.h * zoom));
  }

  renderPalette(currentPalette);
  applyRetroDisplayIfActive();
}

function renderPalette(palette: PaletteData | null) {
  paletteBar.innerHTML = '';
  if (!palette) { setHidden(paletteBar, true); return; }
  setHidden(paletteBar, false);

  const label = document.createElement('span');
  label.textContent = `Palette (${palette.colors.length} colors):`;
  label.style.cssText = 'font-size: 11px; color: var(--text-muted); margin-right: 6px; white-space: nowrap;';
  paletteBar.appendChild(label);

  for (let i = 0; i < Math.min(256, palette.colors.length); i++) {
    const c = palette.colors[i];
    if (!c) continue;
    const swatch = document.createElement('div');
    swatch.className = 'palette-color';
    swatch.title = `Index ${i}: rgb(${c.r}, ${c.g}, ${c.b})`;
    swatch.style.background = `rgb(${c.r}, ${c.g}, ${c.b})`;
    paletteBar.appendChild(swatch);
  }
}

searchEl.addEventListener('input', renderList);

zoomEl.addEventListener('change', () => {
  if (selected) drawAsset();
});

bgEl.addEventListener('change', () => {
  canvasWrap.classList.remove('bg-black', 'bg-white');
  if (bgEl.value === 'black') canvasWrap.classList.add('bg-black');
  if (bgEl.value === 'white') canvasWrap.classList.add('bg-white');
});

// ── Animation autoplay ───────────────────────────────────────────────────
//
// Crawl never had this — added here as a Phase 3 prerequisite: recording
// "the sprite animation" is a non-sequitur without a live-preview notion
// of animation playback to record in the first place. Milliseconds
// between frames matches the interval already used in
// siren/flower/chimera/ceres's equivalent viewers.

const AUTOPLAY_INTERVAL_MS = 150;
let playTimer: ReturnType<typeof setInterval> | null = null;

function stopPlayback(): void {
  if (playTimer !== null) {
    clearInterval(playTimer);
    playTimer = null;
  }
  playToggleEl.textContent = '▶';
  playToggleEl.classList.remove('playing');
}

function togglePlayback(): void {
  if (playTimer !== null) {
    stopPlayback();
    return;
  }
  if (currentFrames.length <= 1) return;
  playToggleEl.textContent = '⏸';
  playToggleEl.classList.add('playing');
  playTimer = setInterval(() => {
    currentFrame = (currentFrame + 1) % currentFrames.length;
    drawAsset();
  }, AUTOPLAY_INTERVAL_MS);
}

playToggleEl.addEventListener('click', togglePlayback);

frameSlider.addEventListener('input', () => {
  if (!selected) return;
  stopPlayback();
  currentFrame = Number(frameSlider.value);
  drawAsset();
});

document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.code === 'ArrowLeft' && currentFrames.length > 0) {
    e.preventDefault();
    stopPlayback();
    currentFrame = (currentFrame - 1 + currentFrames.length) % currentFrames.length;
    drawAsset();
  }
  if (e.code === 'ArrowRight' && currentFrames.length > 0) {
    e.preventDefault();
    stopPlayback();
    currentFrame = (currentFrame + 1) % currentFrames.length;
    drawAsset();
  }
  if (e.code === 'ArrowUp') {
    e.preventDefault();
    void navigateList(-1);
  }
  if (e.code === 'ArrowDown') {
    e.preventDefault();
    void navigateList(1);
  }
});

/** Watermark text for an export. */
function spriteWatermarkText(asset: ManifestEntry): string {
  const gameLabel = GAME_DISPLAY_NAMES[currentGame];
  const platformLabel = PLATFORM_DISPLAY_NAMES[currentPlatform];
  return `${asset.name} — ${gameLabel} (${platformLabel}) — blackcrypt — a seer project`;
}

/**
 * Screenshot export for the 2D draw path, per `2d-export-proposal.md`'s
 * Part 1. `canvas` is a **getter** — the persistent canvases are one of
 * TWO (Canvas2D vs. retro-display's own WebGL2 output), so which element
 * is actually mounted in `canvasWrap` changes depending on the active
 * display profile. `renderNow` re-renders the retro-display canvas if a
 * profile is active — its buffer can go stale between the last actual draw
 * and a later Screenshot click otherwise.
 */
const spriteCaptureSource: CaptureSource = {
  get canvas() {
    return canvasWrap.querySelector('canvas') as HTMLCanvasElement;
  },
  renderNow: applyRetroDisplayIfActive,
};

spriteScreenshotBtn.addEventListener('click', () => {
  if (!selected) return;
  void downloadScreenshot(spriteCaptureSource, selected.name, {
    watermark: { text: spriteWatermarkText(selected) },
  });
});

/**
 * Video export for the 2D draw path (Phase 3 of `2d-export-proposal.md`,
 * built on Phase 2's persistent canvas — `canvas.captureStream()` needs a
 * stable element across frame advances, which is what that phase fixed).
 * Recording always does draw-then-advance (draw the current frame, then
 * advance for the next capture) rather than advance-then-draw, which would
 * skip frame 0 on the very first capture.
 */
const spriteRecordCaptureSource: CaptureSource = {
  get canvas() {
    return canvasWrap.querySelector('canvas') as HTMLCanvasElement;
  },
  renderNow: () => {
    drawAsset();
    if (currentFrames.length > 0) currentFrame = (currentFrame + 1) % currentFrames.length;
  },
};

const spriteRecordDriver: RecordClipDriver = {
  start() {
    stopPlayback();
    currentFrame = 0;
    drawAsset();
  },
  stop() {
    currentFrame = 0;
    drawAsset();
  },
};

spriteRecordBtn.addEventListener('click', () => {
  void (async () => {
    if (!selected || spriteRecordBtn.disabled) return;
    spriteRecordBtn.disabled = true;
    try {
      const result = await recordClip(spriteRecordCaptureSource, {
        driver: spriteRecordDriver,
        fps: 12,
        durationSeconds: 2,
        watermark: { text: spriteWatermarkText(selected) },
      });
      downloadClip(result, selected.name);
    } catch (err) {
      console.error('sprite recording failed', err);
    } finally {
      spriteRecordBtn.disabled = currentFrames.length <= 1;
    }
  })();
});

/**
 * Display profile + colour grading + export (Phases 4-6 of
 * `2d-export-proposal.md`) — one floating panel (same `createPopover`
 * toggle/outside-click/Escape behavior as the other seer-project viewers)
 * housing the retro-display profile/effect sliders, the grading sliders,
 * and the screenshot/record buttons.
 */
createPopover(spriteDisplayToggle, spriteDisplayPanel);

/**
 * Grades via `ctx.filter` (not `style.filter` — the CSS property is
 * compositor-level only and would not appear in a screenshot/recording),
 * applied in `drawSpriteFrame`/`drawFullAtlas` through `buildGradingFilterString`.
 */
function onGradingSliderChange(): void {
  gradingOptions = {
    brightness: Number(gradingBrightnessEl.value),
    contrast: Number(gradingContrastEl.value),
    saturate: Number(gradingSaturateEl.value),
    hueRotate: Number(gradingHueEl.value),
  };
  drawAsset();
}

gradingBrightnessEl.addEventListener('input', onGradingSliderChange);
gradingContrastEl.addEventListener('input', onGradingSliderChange);
gradingSaturateEl.addEventListener('input', onGradingSliderChange);
gradingHueEl.addEventListener('input', onGradingSliderChange);

gradingResetBtn.addEventListener('click', () => {
  gradingBrightnessEl.value = '1';
  gradingContrastEl.value = '1';
  gradingSaturateEl.value = '1';
  gradingHueEl.value = '0';
  gradingOptions = {};
  drawAsset();
});

/**
 * Effect sliders meaningful for the currently-selected profile are enabled;
 * the rest are disabled (not hidden — the layout stays stable as the user
 * flips between profiles). `'none'` disables all of them; `scanlineIntensity`
 * is additionally disabled for `'lcd-subpixel'`, which `RetroDisplayOptions`
 * documents as a no-op there (a flat panel has no scanlines to simulate).
 */
function updateDisplayControlsEnabled(): void {
  const active = displayOptions.profile !== 'none';
  for (const el of [displayMaskEl, displayCurvatureEl, displayVignetteEl, displayGlowEl, displayChromaticEl]) {
    el.disabled = !active;
  }
  displayScanlineEl.disabled = !active || displayOptions.profile === 'lcd-subpixel';
}

function onDisplaySliderChange(): void {
  displayOptions = {
    profile: displayProfileEl.value as DisplayProfile,
    scanlineIntensity: Number(displayScanlineEl.value),
    maskIntensity: Number(displayMaskEl.value),
    curvature: Number(displayCurvatureEl.value),
    vignette: Number(displayVignetteEl.value),
    glow: Number(displayGlowEl.value),
    chromaticAberration: Number(displayChromaticEl.value),
  };
  drawAsset();
}

displayScanlineEl.addEventListener('input', onDisplaySliderChange);
displayMaskEl.addEventListener('input', onDisplaySliderChange);
displayCurvatureEl.addEventListener('input', onDisplaySliderChange);
displayVignetteEl.addEventListener('input', onDisplaySliderChange);
displayGlowEl.addEventListener('input', onDisplaySliderChange);
displayChromaticEl.addEventListener('input', onDisplaySliderChange);

displayProfileEl.addEventListener('change', () => {
  const profile = displayProfileEl.value as DisplayProfile;
  const preset = resolveRetroDisplayOptions({ profile });
  displayScanlineEl.value = String(preset.scanlineIntensity);
  displayMaskEl.value = String(preset.maskIntensity);
  displayCurvatureEl.value = String(preset.curvature);
  displayVignetteEl.value = String(preset.vignette);
  displayGlowEl.value = String(preset.glow);
  displayChromaticEl.value = String(preset.chromaticAberration);
  onDisplaySliderChange();
  updateDisplayControlsEnabled();
});

updateDisplayControlsEnabled();

gameSelectEl.addEventListener('change', () => {
  currentGame = gameSelectEl.value as GameId;
  const platforms = getViewerConfig(currentGame).supportedPlatforms;
  currentPlatform = platforms.length > 0 ? getViewerConfig(currentGame).defaultPlatform : DEFAULT_PLATFORM;
  populatePlatformSelect();
  loadManifest();
});

platformSelectEl.addEventListener('change', () => {
  if (!isPlatformId(platformSelectEl.value)) return;
  currentPlatform = platformSelectEl.value;
  loadManifest();
});

(async () => {
  currentGame = readGameFromUrl();
  currentPlatform = readPlatformFromUrl();
  const config = getViewerConfig(currentGame);
  if (config.supportedPlatforms.length === 0) {
    currentPlatform = DEFAULT_PLATFORM;
  } else if (!config.supportedPlatforms.includes(currentPlatform)) {
    currentPlatform = config.defaultPlatform;
  }

  populateGameSelect();
  populatePlatformSelect();
  await loadManifest();
})();
