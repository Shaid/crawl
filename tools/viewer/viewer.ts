import { setHidden, type AtlasMeta, type PaletteData, type AtlasFrame } from './shared.ts';
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
const paletteBar = document.getElementById('palette-bar')!;
const gameSelectEl = document.getElementById('game-select') as HTMLSelectElement;
const platformSelectEl = document.getElementById('platform-select') as HTMLSelectElement;

let manifest: ManifestEntry[] = [];
let selected: ManifestEntry | null = null;
let currentAtlas: AtlasMeta | null = null;
let currentPalette: PaletteData | null = null;
let currentFrames: AtlasFrame[] = [];
let currentFrame = 0;

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
  titleEl.textContent = 'No asset selected';
  metaEl.textContent = '';
  frameInfoEl.textContent = '';
  setHidden(frameStrip, true);
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
    if (selected === a) item.classList.add('selected');
    item.innerHTML = `<span class="item-label">${a.name}</span><span class="item-dim">${a.sprites}sp${a.hasPalette ? ' · pal' : ''}</span>`;
    item.addEventListener('click', () => selectAsset(a));
    listEl.appendChild(item);
  }
}

async function selectAsset(asset: ManifestEntry) {
  selected = asset;
  currentFrame = 0;
  currentAtlas = await loadJSON<AtlasMeta>(`${asset.name}.json`);
  currentPalette = asset.hasPalette ? await loadJSON<PaletteData>(`${asset.name}.pal.json`) : null;
  currentFrames = currentAtlas?.frames ?? [];
  renderList();
  drawAsset();
}

function drawAsset() {
  if (!selected || !currentAtlas) {
    canvasWrap.innerHTML = '<div class="state-panel"><span class="state-icon">🖼</span><span class="state-title">Select an asset</span></div>';
    return;
  }

  const zoom = Number(zoomEl.value);
  const frame = currentFrames[currentFrame];

  if (frame) {
    titleEl.textContent = `${selected.name} — sprite ${currentFrame + 1}/${currentFrames.length}`;
    metaEl.textContent = `${frame.w}×${frame.h}`;
    frameInfoEl.textContent = `atlas ${currentAtlas.width}×${currentAtlas.height}`;
    setHidden(frameStrip, currentFrames.length <= 1);
    frameSlider.max = String(currentFrames.length - 1);
    frameSlider.value = String(currentFrame);
    frameLabel.textContent = `Sprite ${currentFrame + 1} / ${currentFrames.length}`;

    const img = new Image();
    img.onload = () => {
      canvasWrap.innerHTML = '';
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, frame.w * zoom);
      canvas.height = Math.max(1, frame.h * zoom);
      canvasWrap.appendChild(canvas);
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, frame.x, frame.y, frame.w, frame.h, 0, 0, canvas.width, canvas.height);
    };
    img.onerror = () => {
      canvasWrap.innerHTML = '<div class="state-panel state-error"><span class="state-icon">⚠</span><span class="state-title">Failed to load image</span></div>';
    };
    img.src = `${assetBase}/${selected.name}.png`;

    renderPalette(currentPalette);
  } else {
    drawFullAtlas(selected, currentAtlas, zoom);
  }
}

function drawFullAtlas(asset: ManifestEntry, atlas: AtlasMeta, zoom: number) {
  titleEl.textContent = `${asset.name} — full atlas`;
  metaEl.textContent = `${atlas.width}×${atlas.height}, ${atlas.frames.length} sprites`;
  setHidden(frameStrip, true);

  const img = new Image();
  img.onload = () => {
    const cw = Math.max(1, atlas.width * zoom);
    const ch = Math.max(1, atlas.height * zoom);
    canvasWrap.innerHTML = '';
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    canvasWrap.appendChild(canvas);
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, cw, ch);

    ctx.strokeStyle = 'rgba(255, 255, 0, 0.5)';
    ctx.lineWidth = 1;
    for (const f of atlas.frames) {
      ctx.strokeRect(f.x * zoom, f.y * zoom, Math.max(1, f.w * zoom), Math.max(1, f.h * zoom));
    }

    renderPalette(currentPalette);
  };
  img.onerror = () => {
    canvasWrap.innerHTML = '<div class="state-panel state-error"><span class="state-icon">⚠</span><span class="state-title">Failed to load image</span></div>';
  };
  img.src = `${assetBase}/${asset.name}.png`;
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

frameSlider.addEventListener('input', () => {
  if (!selected) return;
  currentFrame = Number(frameSlider.value);
  drawAsset();
});

document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.code === 'ArrowLeft' && currentFrames.length > 0) {
    e.preventDefault();
    currentFrame = (currentFrame - 1 + currentFrames.length) % currentFrames.length;
    drawAsset();
  }
  if (e.code === 'ArrowRight' && currentFrames.length > 0) {
    e.preventDefault();
    currentFrame = (currentFrame + 1) % currentFrames.length;
    drawAsset();
  }
});

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
