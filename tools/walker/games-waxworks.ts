/**
 * Waxworks (Horror Soft, 1992, Amiga) walker view -- a `renderCanvas`-only
 * `GameView` for the game's first-person maze/room sections.
 *
 * Renderer shape: the game draws **one pre-composed picture per room and
 * facing** -- the room's script (`subroutine_id` of its `room` child) runs
 * `picture <VC script> <window 4>` selected by the facing variable (b150),
 * and that VC script blits the street/wall pieces of the shared graphics bank
 * (zone 18 / 94 for the 15 type-1-only zones) into the 224x127 scene window at
 * screen (48,3). `tools/waxworks/amiga/export-maze.ts` replays those scripts
 * offline, so this view only shows the resulting pictures; there is no
 * per-depth wall compositor. Map = the room database in `gameamiga`
 * (`tools/shared/agos-gamepc.ts`): exits per direction with 2-bit door
 * states, 2,890/2,890 exits reciprocal.
 *
 * Pose: level = world (connected room graph), x/y = layout cell (N = -y), the
 * hidden z (up/down exits) is kept in the view; facing 0..3 = exit index
 * (0 N, 1 E, 2 S, 3 W -- a labelling convention; the game's own meaning is
 * "forward = exit[facing]").
 *
 * Hypotheses (labelled in the confidence note): the compass names; that a
 * left turn is facing-1 (subroutine 25 = +3 mod 4, 24 = +1 mod 4 -- which of
 * the two the on-screen Left arrow calls is not verified); pictures gated by
 * object state (doors opened by keys, lamps, NPCs) show their default state;
 * animated sprites (`loadSprite`) are not drawn.
 */
import type { KeyStateLike, Pose, DrawItem, RGBAColor, PieceBankLookup } from '@seer-project/dungeon';
import type { SlotTableFile } from '@seer-project/dungeon/schema';
import type { GameView } from './games.ts';
import { BACK_DIR, DIR_NAMES, doorState, tryMove, type MazeFile, type MazeRoom, type MazeWorld, type MoveResult } from '../waxworks/amiga/maze-map.ts';

export const SCREEN_W = 320;
export const SCREEN_H = 200;
/** Window 4 (the scene window): 14 x 16 px wide, 127 rows, at screen (48, 3). */
export const SCENE_X = 48;
export const SCENE_Y = 3;
const STEP_COOLDOWN_MS = 200;
/** Item id of the game's start room (`gameamiga` subroutine 101: `goto i311`). */
export const START_ROOM_ID = 311;

export function turnRight(f: number): number {
  return (f + 1) % 4;
}
export function turnLeft(f: number): number {
  return (f + 3) % 4;
}

export function describeFailure(r: Extract<MoveResult, { ok: false }>, dir: number): string {
  switch (r.reason) {
    case 'closed':
      return `the ${DIR_NAMES[dir]} door is closed (needs a script/object to open -- not implemented)`;
    case 'locked':
      return `the ${DIR_NAMES[dir]} door is locked (needs a key -- not implemented)`;
    case 'no-room':
      return 'exit leads outside this world';
    default:
      return `no exit ${DIR_NAMES[dir]}`;
  }
}

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => fail(new Error(`image ${url}`));
    img.src = url;
  });
}

export function startRoomFor(world: MazeWorld, startId: number = START_ROOM_ID): MazeRoom {
  return world.rooms.find((r) => r.id === startId) ?? world.rooms.find((r) => r.pics[0]) ?? world.rooms[0];
}

export class WaxworksView implements GameView {
  readonly id: string;
  readonly gameLabel: string;
  readonly items: DrawItem[] = [];
  readonly banks: PieceBankLookup = {};
  readonly slots: SlotTableFile = { schemaVersion: 1, banks: [], slotRows: [] } as unknown as SlotTableFile;
  readonly automap = undefined;
  readonly palette: RGBAColor[] = [];

  private tick = 0;
  private noclip = false;
  private cooldown = 0;
  private pendingPose: Pose | null = null;
  private message: string | null = null;
  private roomId: number;
  private facing: number;
  private readonly byId: Map<number, MazeRoom>;
  private readonly sheets = new Map<number, HTMLImageElement | 'loading' | 'failed'>();

  readonly maze: MazeFile;
  readonly worldIndex: number;
  private readonly assetBase: string | null;

  constructor(maze: MazeFile, worldIndex: number, assetBase: string | null, start: { roomId: number; facing: number }, who: { id: string; label: string } = { id: 'waxworks', label: 'Waxworks' }) {
    this.id = who.id;
    this.gameLabel = who.label;
    this.maze = maze;
    this.worldIndex = worldIndex;
    this.assetBase = assetBase;
    this.byId = new Map(maze.worlds[worldIndex].rooms.map((r) => [r.id, r]));
    this.roomId = start.roomId;
    this.facing = start.facing;
  }

  get world(): MazeWorld { return this.maze.worlds[this.worldIndex]; }
  get room(): MazeRoom { return this.byId.get(this.roomId)!; }
  get levelId(): number { return this.worldIndex; }
  get levelLabel(): string { return this.world.label; }
  get currentTick(): number { return this.tick; }
  get pose(): Pose {
    const r = this.room;
    return { level: this.worldIndex, x: r.x, y: r.y, facing: this.facing as Pose['facing'] };
  }

  /** Move through exit `dir` (0..5). Returns the new pose or null. */
  step(dir: number): Pose | null {
    if (this.noclip) {
      const r = this.room;
      const t = r.exits[dir];
      if (t && this.byId.has(t)) { this.roomId = t; this.message = null; return this.pose; }
    }
    const res = tryMove(this.byId, this.roomId, dir);
    if (!res.ok) { this.message = describeFailure(res, dir); return null; }
    this.roomId = res.to;
    this.message = null;
    return this.pose;
  }
  forward(): Pose | null { return this.step(this.facing); }
  turn(kind: 'left' | 'right' | 'around'): Pose {
    this.facing = kind === 'left' ? turnLeft(this.facing) : kind === 'right' ? turnRight(this.facing) : (this.facing + 2) % 4;
    this.message = null;
    return this.pose;
  }

  update(dtMs: number, keys: KeyStateLike): Pose | null {
    this.tick += dtMs;
    this.cooldown = Math.max(0, this.cooldown - dtMs);
    if (this.pendingPose) { const p = this.pendingPose; this.pendingPose = null; return p; }
    if (this.cooldown > 0) return null;
    const down = (...codes: string[]) => codes.some((c) => keys.isDown(c));
    let p: Pose | null = null;
    let tried = true;
    if (down('KeyW', 'ArrowUp')) p = this.forward();
    else if (down('KeyA', 'ArrowLeft')) p = this.turn('left');
    else if (down('KeyD', 'ArrowRight')) p = this.turn('right');
    else if (down('KeyS', 'ArrowDown')) p = this.turn('around');
    else if (down('KeyR', 'PageUp')) p = this.step(4);
    else if (down('KeyF', 'PageDown')) p = this.step(5);
    else tried = false;
    if (tried) this.cooldown = STEP_COOLDOWN_MS;
    return p;
  }

  takeLevelChange(): Pose | null { return null; }
  takeMessage(): string | null { const m = this.message; this.message = null; return m; }
  setPose(pose: Pose): void {
    const w = this.world;
    const here = this.room;
    const cands = w.rooms.filter((r) => r.x === pose.x && r.y === pose.y);
    const hit = cands.find((r) => r.z === here.z) ?? cands[0];
    if (hit) this.roomId = hit.id;
    this.facing = pose.facing;
  }
  setNoclip(on: boolean): void { this.noclip = on; }
  interactCodes(): string[] { return []; }
  automapCodes(): string[] { return []; }

  /** Click in 320x200 canvas space: left/right thirds of the scene turn, the middle walks forward. */
  pick(x: number, y: number): void {
    if (y < SCENE_Y || y >= SCENE_Y + this.maze.picHeight || x < SCENE_X || x >= SCENE_X + this.maze.picWidth) return;
    const rel = (x - SCENE_X) / this.maze.picWidth;
    const p = rel < 0.25 ? this.turn('left') : rel > 0.75 ? this.turn('right') : this.forward();
    if (p) this.pendingPose = p;
  }

  private sheet(zone: number): HTMLImageElement | null {
    const cur = this.sheets.get(zone);
    if (cur && cur !== 'loading' && cur !== 'failed') return cur;
    if (!cur && this.assetBase) {
      this.sheets.set(zone, 'loading');
      loadImage(`${this.assetBase}/maze/z${zone}.png`).then((i) => this.sheets.set(zone, i), () => this.sheets.set(zone, 'failed'));
    }
    return null;
  }

  /** Picture handle shown for the current room/facing (0 = none); `maze.pictures[handle].script` is the VC script id. */
  get pictureId(): number { return this.room.pics[this.facing] ?? 0; }

  renderCanvas(ctx: CanvasRenderingContext2D): void {
    ctx.canvas.width = SCREEN_W;
    ctx.canvas.height = SCREEN_H;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
    const { picWidth: pw, picHeight: ph, sheetCols } = this.maze;
    const pid = this.pictureId;
    const ref = pid ? this.maze.pictures[String(pid)] : undefined;
    const img = ref ? this.sheet(ref.zone) : null;
    if (ref && img) {
      ctx.drawImage(img, (ref.index % sheetCols) * pw, Math.floor(ref.index / sheetCols) * ph, pw, ph, SCENE_X, SCENE_Y, pw, ph);
    } else {
      ctx.fillStyle = '#222';
      ctx.fillRect(SCENE_X, SCENE_Y, pw, ph);
      ctx.fillStyle = '#aaa';
      ctx.font = '8px monospace';
      ctx.fillText(ref ? 'loading picture...' : 'no picture for this room/facing', SCENE_X + 8, SCENE_Y + 20);
    }
    // HUD
    const r = this.room;
    ctx.fillStyle = '#ccc';
    ctx.font = '8px monospace';
    ctx.fillText(`room ${r.id}  facing ${DIR_NAMES[this.facing]}  pic ${ref ? ref.script : '-'}${r.uncertain ? '  (state-gated)' : ''}`, 4, 142);
    let ex = '';
    for (let d = 0; d < 6; d++) {
      const st = doorState(r, d);
      if (st) ex += `${DIR_NAMES[d]}${st === 1 ? '' : st === 2 ? '(closed)' : '(locked)'} `;
    }
    ctx.fillText(`exits: ${ex || 'none'}`, 4, 152);
    ctx.fillText('W fwd  A/D turn  S about  R/F up/down', 4, 162);
  }

  renderMinimap(ctx: CanvasRenderingContext2D): void {
    const size = 224;
    ctx.canvas.width = size;
    ctx.canvas.height = size;
    ctx.fillStyle = '#141420';
    ctx.fillRect(0, 0, size, size);
    const here = this.room;
    const radius = 9;
    const cs = size / (radius * 2 + 1);
    const at = (r: MazeRoom) => [(r.x - here.x + radius) * cs, (r.y - here.y + radius) * cs] as const;
    for (const r of this.world.rooms) {
      if (r.z !== here.z || Math.abs(r.x - here.x) > radius || Math.abs(r.y - here.y) > radius) continue;
      const [px, py] = at(r);
      ctx.fillStyle = '#2c3248';
      ctx.fillRect(px + 1, py + 1, cs - 2, cs - 2);
      ctx.fillStyle = '#7ad';
      const m = cs * 0.3;
      if (doorState(r, 0)) ctx.fillRect(px + cs / 2 - m / 2, py, m, 2);
      if (doorState(r, 2)) ctx.fillRect(px + cs / 2 - m / 2, py + cs - 2, m, 2);
      if (doorState(r, 3)) ctx.fillRect(px, py + cs / 2 - m / 2, 2, m);
      if (doorState(r, 1)) ctx.fillRect(px + cs - 2, py + cs / 2 - m / 2, 2, m);
    }
    ctx.fillStyle = '#e44';
    const [cx, cy] = at(here);
    ctx.beginPath();
    ctx.arc(cx + cs / 2, cy + cs / 2, cs * 0.3, 0, Math.PI * 2);
    ctx.fill();
    const a = (this.facing * Math.PI) / 2 - Math.PI / 2;
    ctx.strokeStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(cx + cs / 2, cy + cs / 2);
    ctx.lineTo(cx + cs / 2 + Math.cos(a) * cs * 0.6, cy + cs / 2 + Math.sin(a) * cs * 0.6);
    ctx.stroke();
  }
}
void BACK_DIR;

let cached: MazeFile | null = null;
async function getMaze(assetBase: string): Promise<MazeFile> {
  if (!cached) cached = await fetchJSON<MazeFile>(`${assetBase}/data/maze.json`);
  return cached;
}

export async function waxworksLevelListFromAssets(assetBase: string): Promise<Array<{ id: number; label: string }>> {
  const m = await getMaze(assetBase);
  return m.worlds.map((w) => ({ id: w.id, label: w.label }));
}

export async function loadWaxworksView(assetBase: string, levelId: number, start: Pose | null): Promise<WaxworksView> {
  const maze = await getMaze(assetBase);
  const wi = Math.min(Math.max(levelId, 0), maze.worlds.length - 1);
  const world = maze.worlds[wi];
  let roomId = startRoomFor(world).id;
  let facing = 0;
  if (start) {
    const hit = world.rooms.find((r) => r.x === start.x && r.y === start.y);
    if (hit) roomId = hit.id;
    facing = start.facing;
  }
  return new WaxworksView(maze, wi, assetBase, { roomId, facing });
}
