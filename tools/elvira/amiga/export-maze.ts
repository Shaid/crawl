/**
 * Elvira 1 (Amiga) room-graph exporter -- the Waxworks pipeline's output
 * shape (`maze.json` + per-zone picture sheets, consumed by the shared
 * `WaxworksView`) built from Elvira 1's own dialect:
 *   - `gameamiga` (variant `elvira1`: 875 items, exact consumption to EOF,
 *     357 script subroutines; `tools/shared/agos-gamepc.ts`),
 *   - the 284-entry opcode grammar in `runit`,
 *   - rooms = items carrying a room child (own or inherited); exits = their
 *     general-exit child; a destination that is not a room is a door item
 *     (state 0 = open -> its parent room, 1 = closed, 2+ = locked),
 *   - the room's scene subroutine is `1000 + userflags[0]` (subroutine 9),
 *     evaluated by `room-script.ts` for the four facings (v150 = 0/2/4/6),
 *   - pictures composed from the zones' VC scripts (`agos-vc.ts`, the
 *     Elvira 1 dialect table, 750/750).
 *
 * Usage: npx tsx tools/elvira/amiga/export-maze.ts [dataDir]
 * Writes public/assets/elvira/amiga/data/maze.json + maze/z<zone>.png.
 *
 * View facing convention: facing f = `moveDirn` direction (0 N, 1 E, 2 S,
 * 3 W; forward = exit[facing]); the game's v150 for it is 0/6/4/2.
 */
import { readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { writePNG, writeJson } from '@seer-project/pipeline';
import { simonDecr, discoverZones, loadPalette } from '../../shared/agos-vga.ts';
import { readGamePc, readGrammarFromExe, type AgosItem, type GamePcDatabase, type ItemChild } from '../../shared/agos-gamepc.ts';
import { parseVga1, composePicture, WINDOW4, ELVIRA1_VC_PARAM_BYTES, type ZoneResources } from '../../shared/agos-vc.ts';
import { layoutRooms, type MazeFile, type MazeRoom, type MazeWorld } from '../../waxworks/amiga/maze-map.ts';
import { packSheets } from '../../waxworks/amiga/export-maze.ts';
import { FACING_TO_DIR, FACINGS, roomPictureFor, type PictureCall } from './room-script.ts';

/** First room of the game: `goto i876` closes the start-up block of subroutine 101 (HYPOTHESIS: the player's initial location). */
export const ELVIRA1_START_ROOM = 876;

/** Child lookup following `inherit` masters (the game's `findChildOfType`). */
export function findChild<K extends ItemChild['kind']>(items: Map<number, AgosItem>, id: number, kind: K): Extract<ItemChild, { kind: K }> | undefined {
  let it = items.get(id);
  for (let depth = 0; it && depth < 8; depth++) {
    const c = it.children.find((x) => x.kind === kind);
    if (c) return c as Extract<ItemChild, { kind: K }>;
    const inh = it.children.find((x) => x.kind === 'inherit');
    it = inh && inh.kind === 'inherit' ? items.get(inh.master) : undefined;
  }
  return undefined;
}

export interface E1Exit {
  /** Destination room id, 0 = none/blocked outright. */
  dest: number;
  /** 0 none, 1 open, 2 closed, 3 locked. */
  state: number;
}

/** The game's `getExitOf_e1` / `getDoorOf` pair for one direction of a room. */
export function exitOf(items: Map<number, AgosItem>, room: number, dir: number): E1Exit {
  const ge = findChild(items, room, 'genexit');
  const x = ge?.dest[dir] ?? 0;
  if (!x) return { dest: 0, state: 0 };
  if (findChild(items, x, 'e1room')) return { dest: x, state: 1 };
  const it = items.get(x);
  if (!it) return { dest: 0, state: 0 };
  const parent = it.parent;
  if (it.state === 0) return parent ? { dest: parent, state: 1 } : { dest: 0, state: 0 };
  return { dest: parent, state: it.state === 1 ? 2 : 3 };
}

export function roomIds(items: Map<number, AgosItem>): number[] {
  return [...items.keys()].filter((id) => findChild(items, id, 'e1room') && findChild(items, id, 'genexit')).sort((a, b) => a - b);
}

export function loadElvira1(dataDir: string): { db: GamePcDatabase; grammar: string[] } {
  const grammar = readGrammarFromExe(new Uint8Array(readFileSync(resolve(dataDir, 'runit'))), 'elvira1');
  const db = readGamePc(new Uint8Array(readFileSync(resolve(dataDir, 'gameamiga'))), 'elvira1', grammar);
  return { db, grammar };
}

export interface BuiltMaze {
  maze: MazeFile;
  sheets: Map<number, { width: number; height: number; rgba: Uint8Array }>;
}

export function buildMaze(dataDir: string): BuiltMaze {
  const raw = (f: string) => simonDecr(new Uint8Array(readFileSync(resolve(dataDir, f))));
  const { db } = loadElvira1(dataDir);
  const items = db.items;
  const subs = db.subroutines;
  const rooms = roomIds(items);
  const roomSet = new Set(rooms);

  const zoneFiles = discoverZones(readdirSync(dataDir), 'elvira');
  const bank = new Map<string, Uint8Array>();
  const load = (f: string) => bank.get(f) ?? (bank.set(f, raw(f)), bank.get(f)!);
  const resCache = new Map<number, ZoneResources | undefined>();
  const zoneRes = (zone: number): ZoneResources | undefined => {
    if (resCache.has(zone)) return resCache.get(zone);
    const zf = zoneFiles.find((z) => z.zone === zone);
    const r = zf?.type1 && zf.type2 ? { vga1: parseVga1(load(zf.type1), ELVIRA1_VC_PARAM_BYTES), vga2: load(zf.type2) } : undefined;
    resCache.set(zone, r);
    return r;
  };

  interface Composed { zone: number; script: number; indices: Uint8Array; palette: { r: number; g: number; b: number }[] }
  const composed: Composed[] = [];
  const handleByKey = new Map<string, number>();
  const picture = (call: PictureCall): number => {
    const zone = Math.floor(call.id / 100);
    const r = zoneRes(zone);
    if (!r) return 0;
    const c = composePicture(call.id, { zone: (z) => zoneRes(z), vars: call.vars, bits: new Set() });
    if (c.draws === 0) return 0;
    const key = `${call.id}|${[...c.reads].sort().map(([k, v]) => `${k}=${v}`).join(',')}`;
    let h = handleByKey.get(key);
    if (!h) {
      composed.push({ zone, script: call.id, indices: c.indices, palette: c.palette ?? loadPalette(r.vga1.data, 0, 16) });
      h = composed.length;
      handleByKey.set(key, h);
    }
    return h;
  };

  // Room graph: exits of every room (any door state keeps the link).
  const exitsOf = new Map<number, E1Exit[]>();
  for (const id of rooms) exitsOf.set(id, [0, 1, 2, 3, 4, 5].map((d) => exitOf(items, id, d)));
  const adj = new Map<number, Set<number>>();
  const link = (a: number, b: number) => (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b);
  for (const [id, ex] of exitsOf) for (const e of ex) if (e.dest && roomSet.has(e.dest)) (link(id, e.dest), link(e.dest, id));
  const seen = new Set<number>();
  const comps: number[][] = [];
  for (const id of rooms) {
    if (seen.has(id) || !adj.has(id)) continue;
    const comp: number[] = [];
    const st = [id];
    seen.add(id);
    while (st.length) {
      const n = st.pop()!;
      comp.push(n);
      for (const m of adj.get(n) ?? []) if (!seen.has(m)) (seen.add(m), st.push(m));
    }
    comps.push(comp.sort((a, b) => a - b));
  }

  const stats: Record<string, number | string> = { rooms: 0, roomPictures: 0, roomPicturesRendered: 0, roomsUncertain: 0, roomsWithoutSceneSub: 0, unmodelledOps: 0 };
  const unmodelledAll = new Set<number>();
  const worlds: MazeWorld[] = [];
  comps
    .sort((a, b) => b.length - a.length)
    .forEach((comp, wi) => {
      const lay = layoutRooms(comp, (id) => exitsOf.get(id)!.map((e) => (roomSet.has(e.dest) ? e.dest : 0)));
      const zoneCount: Record<string, number> = {};
      const mrooms: MazeRoom[] = [];
      for (const id of comp) {
        const ex = exitsOf.get(id)!;
        const exits = [0, 0, 0, 0, 0, 0];
        let doorStates = 0;
        ex.forEach((e, d) => {
          if (e.dest && roomSet.has(e.dest)) {
            exits[d] = e.dest;
            doorStates |= e.state << (d * 2);
          }
        });
        const uf = findChild(items, id, 'userflags');
        const sub = uf ? subs.get(1000 + uf.flags[0]) : undefined;
        const pics = [0, 0, 0, 0];
        let uncertain = false;
        if (!sub) stats.roomsWithoutSceneSub = (stats.roomsWithoutSceneSub as number) + 1;
        else {
          for (const f of FACINGS) {
            const { call, result } = roomPictureFor(id, sub, items, subs, f);
            result.unmodelled.forEach((o) => unmodelledAll.add(o));
            if (result.gatedPicture) uncertain = true;
            if (!call) continue;
            (stats.roomPictures as number)++;
            const h = picture(call);
            if (h) {
              pics[FACING_TO_DIR[f]] = h;
              (stats.roomPicturesRendered as number)++;
              const zk = String(Math.floor(call.id / 100));
              zoneCount[zk] = (zoneCount[zk] ?? 0) + 1;
            }
          }
        }
        if (uncertain) (stats.roomsUncertain as number)++;
        const p = lay.pos.get(id)!;
        mrooms.push({ id, x: p[0], y: p[1], z: p[2], exits, doorStates, pics, uncertain });
      }
      (stats.rooms as number) += comp.length;
      const w: MazeWorld = { id: wi, label: '', zones: zoneCount, rooms: mrooms };
      if (comp.includes(ELVIRA1_START_ROOM)) w.start = { id: ELVIRA1_START_ROOM, facing: 0 };
      worlds.push(w);
    });
  stats.unmodelledOps = unmodelledAll.size;
  const { sheets, refs } = packSheets(composed);
  for (const w of worlds) {
    const zs = Object.entries(w.zones).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([z]) => z);
    const full = w.rooms.filter((r) => r.pics.every(Boolean)).length;
    w.label = `World ${w.id + 1}: ${w.rooms.length} rooms, ${Math.round((100 * full) / w.rooms.length)}% fully pictured (zones ${zs.join(', ')})`;
  }
  const maze: MazeFile = { version: 1, picWidth: WINDOW4.w, picHeight: WINDOW4.h, sheetCols: 8, worlds, pictures: refs, stats: stats as Record<string, number> };
  return { maze, sheets };
}

export async function exportElvira1Maze(dataDir: string): Promise<MazeFile> {
  const { maze, sheets } = buildMaze(dataDir);
  const out = resolve('public/assets/elvira/amiga');
  mkdirSync(resolve(out, 'maze'), { recursive: true });
  mkdirSync(resolve(out, 'data'), { recursive: true });
  for (const [zone, s] of sheets) await writePNG(resolve(out, 'maze', `z${zone}.png`), s.rgba, s.width, s.height);
  await writeJson(resolve(out, 'data', 'maze.json'), maze);
  console.log(
    `elvira/amiga maze: ${maze.worlds.length} worlds, ${maze.stats.rooms} rooms, ${Object.keys(maze.pictures).length} pictures in ${sheets.size} sheets, ` +
      `${maze.stats.roomPicturesRendered}/${maze.stats.roomPictures} room pictures rendered, ${maze.stats.roomsUncertain} rooms gated by unmodelled conditions`,
  );
  return maze;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dataDir = resolve(process.argv[2] ?? 'data/elvira/amiga/data');
  if (!existsSync(dataDir)) throw new Error(`no data dir ${dataDir}`);
  exportElvira1Maze(dataDir).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
