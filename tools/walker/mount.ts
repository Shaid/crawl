/**
 * Mounts any walker `GameView` on canvases owned by another page (the remake host shell): the same render pipeline as `walker.ts`'s main loop (full-colour `renderCanvas`
 * views, or `compositeDrawList` -> `CanvasPresenter` for DrawItem views; the package minimap or the view's own `renderMinimap`; the BC automap window), without the walker
 * page's DOM lookups. The walker page itself keeps its inline copy of these ~40 lines so its behaviour is untouched. Not covered here: automap zoom, noclip, keyboard input.
 */
import { IndexedSurface, compositeDrawList, CanvasPresenter, renderAutomap, Minimap } from '@seer-project/dungeon';
import type { GameView } from './games.ts';

const MINIMAP_RADIUS = 6, AUTOMAP_RADIUS = 8, AUTOMAP_TILE = 8;

export class WalkerMount {
  private view: GameView | null = null;
  private readonly surface = new IndexedSurface(320, 200);
  private readonly presenter: CanvasPresenter;
  private readonly miniCanvas: HTMLCanvasElement; private readonly autoCanvas: HTMLCanvasElement;
  private minimap: Minimap | null = null;
  private autoPresenter: CanvasPresenter | null = null;
  private lastItems: unknown = null; private lastPalette: unknown = null;
  private lastPose = '';
  private readonly onClick: (ev: MouseEvent) => void;
  private readonly canvas: HTMLCanvasElement;
  constructor(canvas: HTMLCanvasElement, side: HTMLElement) {
    this.canvas = canvas;
    canvas.width = 320; canvas.height = 200;
    this.presenter = new CanvasPresenter(canvas.getContext('2d')!);
    const mk = (title: string) => { const c = side.ownerDocument.createElement('canvas'); c.className = 'panelcanvas'; c.title = title; c.style.display = 'none'; side.append(c); return c; };
    this.miniCanvas = mk('minimap'); this.autoCanvas = mk('automap');
    this.onClick = ev => {
      const r = canvas.getBoundingClientRect();
      this.view?.pick(((ev.clientX - r.left) / r.width) * canvas.width, ((ev.clientY - r.top) / r.height) * canvas.height, this.presenter.scale);
    };
    canvas.addEventListener('click', this.onClick);
  }
  /** the view to draw (a new one after a map change replaces the old) */
  setView(v: GameView) {
    this.view = v; this.lastItems = null; this.lastPalette = null; this.lastPose = '';
    const hasAuto = !!v.automap, hasMini = hasAuto || !!v.renderMinimap;
    this.miniCanvas.style.display = hasMini ? '' : 'none'; this.autoCanvas.style.display = hasAuto ? '' : 'none';
    if (v.automap && !v.renderMinimap) this.minimap = new Minimap(this.miniCanvas.getContext('2d')!, { radius: MINIMAP_RADIUS }); else this.minimap = null;
    this.autoPresenter = v.automap ? new CanvasPresenter(this.autoCanvas.getContext('2d')!) : null;
  }
  get current() { return this.view; }
  /** draw the picture, and the side panels when the pose changed */
  render() {
    const v = this.view; if (!v) return;
    if (v.renderCanvas) v.renderCanvas(this.canvas.getContext('2d')!);
    else if (v.items !== this.lastItems || v.palette !== this.lastPalette) {
      this.lastItems = v.items; this.lastPalette = v.palette;
      this.surface.clear(0);
      compositeDrawList(this.surface, v.banks, v.slots, v.items, v.currentTick);
      this.presenter.present(this.surface, v.palette);
    }
    const p = v.pose, key = `${p.level},${p.x},${p.y},${p.facing}`;
    if (key === this.lastPose) return;
    this.lastPose = key;
    v.automap?.state.onEnterCell(p.level, p.x, p.y);
    if (v.renderMinimap) v.renderMinimap(this.miniCanvas.getContext('2d')!);
    else if (v.automap && this.minimap) this.minimap.render(v.automap.level, p);
    if (v.automap && this.autoPresenter) {
      const { level, bank, state } = v.automap, span = AUTOMAP_RADIUS * 2 + 1, size = span * AUTOMAP_TILE;
      this.autoCanvas.width = size; this.autoCanvas.height = size;
      const s = new IndexedSurface(size, size);
      renderAutomap(s, bank, level, state.visitedCells(p.level), { x: p.x - AUTOMAP_RADIUS, y: p.y + AUTOMAP_RADIUS }, { party: { x: p.x, y: p.y, facing: p.facing } });
      this.autoPresenter.present(s, bank.palette);
    }
  }
  /** a map change: the pose key must be redrawn even when x/y/facing coincide */
  invalidate() { this.lastPose = ''; }
  dispose() { this.canvas.removeEventListener('click', this.onClick); this.miniCanvas.remove(); this.autoCanvas.remove(); this.view = null; }
}
