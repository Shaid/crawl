/**
 * Waxworks (Amiga) maze/room-graph exporter.
 *
 * Usage: npx tsx tools/waxworks/amiga/export-maze.ts [dataDir]
 *
 * Reads `gameamiga` (items -> rooms + exits + door states), the `tables`/
 * `xtable` subroutine files, and the VC picture scripts in each zone's
 * `vga1`; evaluates every room's subroutine for each of the 4 facings
 * (`room-script.ts`), composes each resulting picture (`agos-vc.ts`) into the
 * 224x127 main window and writes:
 *   public/assets/waxworks/amiga/data/maze.json
 *   public/assets/waxworks/amiga/maze/z<zone>.png   (picture sheets, one per zone)
 * Decoded intermediates are not written; everything is regenerated from data/.
 */
import { readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { writePNG, writeJson } from '@seer-project/pipeline';
import { simonDecr, discoverZones, loadPalette } from '../../shared/agos-vga.ts';
import { readGamePc, readGrammarFromExe, readSubroutineBlock, roomsOf, type Subroutine } from '../../shared/agos-gamepc.ts';
import { parseVga1, composePicture, WINDOW4, VC_PARAM_BYTES, type ZoneResources } from '../../shared/agos-vc.ts';
import { layoutRooms, type MazeFile, type MazeRoom, type MazeWorld } from './maze-map.ts';
import { roomPictureFor, type PictureCall } from './room-script.ts';

const GAME = 'waxworks';
const PLATFORM = 'amiga';
const SHEET_COLS = 8;

/** What differs between the AGOS room-graph games that share this exporter. */
export interface MazeSpec {
  variant: 'waxworks' | 'elvira2';
  scheme: 'elvira' | 'waxworks';
  /** `gameamiga` is `simon_decr`-packed on disk (Waxworks) or stored plain (Elvira II). */
  packedGamePc: boolean;
  /** Zones whose `vga2` is a shared picture bank (no type-2 file of their own): zone -> bank zone. */
  sharedBank: (zone: number) => number;
  vcTable: readonly number[];
  /** Smallest connected room set exported as a world. */
  minWorldRooms: number;
}
export const WAXWORKS_SPEC: MazeSpec = {
  variant: 'waxworks',
  scheme: 'waxworks',
  packedGamePc: true,
  /** `zoneTable[zone] == 3` in the game == no type-2 file. */
  sharedBank: (zone) => (zone >= 85 ? 94 : 18),
  vcTable: VC_PARAM_BYTES,
  minWorldRooms: 5,
};

export interface BuiltMaze {
  maze: MazeFile;
  sheets: Map<number, { width: number; height: number; rgba: Uint8Array }>;
}

function loadSubroutines(dataDir: string, grammar: string[], gameSubs: Subroutine[]): { map: Map<number, Subroutine>; duplicates: number } {
  const map = new Map<number, Subroutine>();
  let duplicates = 0;
  const add = (s: Subroutine) => {
    if (map.has(s.id)) duplicates++;
    map.set(s.id, s);
  };
  for (const f of readdirSync(dataDir).filter((n) => /^(x?tables?)\d\d$/i.test(n)).sort()) {
    const { subs, end } = readSubroutineBlock(new Uint8Array(readFileSync(resolve(dataDir, f))), 0, grammar);
    const len = readFileSync(resolve(dataDir, f)).length;
    if (end !== len) throw new Error(`${f}: subroutine block ended at ${end} of ${len}`);
    subs.forEach(add);
  }
  gameSubs.forEach((s) => map.set(s.id, s)); // resident `gameamiga` subroutines win (loaded first in the game)
  return { map, duplicates };
}

export function buildMaze(dataDir: string, spec: MazeSpec = WAXWORKS_SPEC): BuiltMaze {
  const raw = (f: string) => simonDecr(new Uint8Array(readFileSync(resolve(dataDir, f))));
  const sharedBank = spec.sharedBank;
  const grammar = readGrammarFromExe(new Uint8Array(readFileSync(resolve(dataDir, 'runit'))));
  const db = readGamePc(spec.packedGamePc ? raw('gameamiga') : new Uint8Array(readFileSync(resolve(dataDir, 'gameamiga'))), spec.variant, grammar);
  const { map: subs, duplicates } = loadSubroutines(dataDir, grammar, [...db.subroutines.values()]);
  const rooms = roomsOf(db);

  const files = readdirSync(dataDir);
  const zoneFiles = discoverZones(files, spec.scheme);
  const bankCache = new Map<string, Uint8Array>();
  const loadBank = (f: string) => {
    let b = bankCache.get(f);
    if (!b) {
      b = raw(f);
      bankCache.set(f, b);
    }
    return b;
  };
  const resCache = new Map<number, ZoneResources | undefined>();
  const zoneRes = (zone: number): ZoneResources | undefined => {
    if (resCache.has(zone)) return resCache.get(zone);
    const zf = zoneFiles.find((z) => z.zone === zone);
    let r: ZoneResources | undefined;
    if (zf?.type1) {
      const f2 = zf.type2 ?? zoneFiles.find((z) => z.zone === sharedBank(zone))?.type2;
      if (f2) r = { vga1: parseVga1(loadBank(zf.type1), spec.vcTable), vga2: loadBank(f2) };
    }
    resCache.set(zone, r);
    return r;
  };

  // Room graph components.
  const adj = new Map<number, Set<number>>();
  for (const [id, r] of rooms) {
    for (const e of r.exits) {
      if (!rooms.has(e.dest)) continue;
      (adj.get(id) ?? adj.set(id, new Set()).get(id)!).add(e.dest);
      (adj.get(e.dest) ?? adj.set(e.dest, new Set()).get(e.dest)!).add(id);
    }
  }
  const seen = new Set<number>();
  const comps: number[][] = [];
  for (const id of rooms.keys()) {
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

  const picEnv = { zone: (z: number) => zoneRes(z) };
  interface Composed { zone: number; script: number; indices: Uint8Array; palette: { r: number; g: number; b: number }[] }
  /** Pictures whose script never ran `setPalette`: they fall back to bank 0 of the zone's own `vga1` (guess). */
  const noPaletteZones = new Map<number, number>();
  const composed: Composed[] = []; // index = handle - 1
  const handleByKey = new Map<string, number>();
  /** Compose a picture call; identical (script, consulted-variables) runs share one handle. 0 = nothing drawn. */
  const picture = (call: PictureCall): number => {
    const zone = Math.floor(call.id / 100);
    const r = zoneRes(zone);
    if (!r) return 0;
    const c = composePicture(call.id, { zone: picEnv.zone, vars: call.vars, bits: call.bits });
    if (c.draws === 0) return 0;
    const key = `${call.id}|${[...c.reads].sort().map(([k, v]) => `${k}=${v}`).join(',')}`;
    let h = handleByKey.get(key);
    if (!h) {
      if (!c.palette) noPaletteZones.set(zone, (noPaletteZones.get(zone) ?? 0) + 1);
      composed.push({ zone, script: call.id, indices: c.indices, palette: c.palette ?? loadPalette(r.vga1.data, 0, 16) });
      h = composed.length;
      handleByKey.set(key, h);
    }
    return h;
  };

  const stats = { rooms: 0, roomPictures: 0, roomPicturesRendered: 0, roomsUncertain: 0, tableDuplicates: duplicates, unmodelledOps: 0 };
  const worldList: MazeWorld[] = [];
  const unmodelledAll = new Set<number>();
  comps
    .filter((c) => c.length >= spec.minWorldRooms)
    .sort((a, b) => b.length - a.length)
    .forEach((comp, wi) => {
      const lay = layoutRooms(comp, (id) => {
        const ex = [0, 0, 0, 0, 0, 0];
        for (const e of rooms.get(id)!.exits) if (rooms.has(e.dest)) ex[e.dir] = e.dest;
        return ex;
      });
      const mrooms: MazeRoom[] = [];
      const zoneCount: Record<string, number> = {};
      for (const id of comp) {
        const rc = rooms.get(id)!;
        const exits = [0, 0, 0, 0, 0, 0];
        for (const e of rc.exits) exits[e.dir] = e.dest;
        const sub = subs.get(rc.subroutineId);
        const pics = [0, 0, 0, 0];
        let uncertain = false;
        if (sub) {
          for (let f = 0; f < 4; f++) {
            const { call, result } = roomPictureFor(sub, db.items, f);
            result.unmodelled.forEach((o) => unmodelledAll.add(o));
            if (result.gatedPicture) uncertain = true;
            if (call) {
              stats.roomPictures++;
              const h = picture(call);
              if (h) {
                pics[f] = h;
                stats.roomPicturesRendered++;
                const zk = String(Math.floor(call.id / 100));
                zoneCount[zk] = (zoneCount[zk] ?? 0) + 1;
              }
            }
          }
        }
        if (uncertain) stats.roomsUncertain++;
        const p = lay.pos.get(id)!;
        mrooms.push({ id, x: p[0], y: p[1], z: p[2], exits, doorStates: rc.exitStates, pics, uncertain });
      }
      stats.rooms += comp.length;
      worldList.push({ id: wi, label: '', zones: zoneCount, rooms: mrooms });
    });
  stats.unmodelledOps = unmodelledAll.size;
  const noPalette = [...noPaletteZones.values()].reduce((a, b) => a + b, 0);
  (stats as Record<string, unknown>).picturesWithoutSetPalette = noPalette;
  (stats as Record<string, unknown>).zonesWithoutSetPalette = [...noPaletteZones.keys()].sort((a, b) => a - b).join(',');

  // Pack the rendered pictures into one sheet per zone.
  const byZone = new Map<number, number[]>();
  composed.forEach((p, i) => (byZone.get(p.zone) ?? byZone.set(p.zone, []).get(p.zone)!).push(i + 1));
  const sheets = new Map<number, { width: number; height: number; rgba: Uint8Array }>();
  const refs: MazeFile['pictures'] = {};
  for (const [zone, handles] of [...byZone].sort((a, b) => a[0] - b[0])) {
    const rowsN = Math.ceil(handles.length / SHEET_COLS);
    const width = SHEET_COLS * WINDOW4.w;
    const height = rowsN * WINDOW4.h;
    const rgba = new Uint8Array(width * height * 4);
    handles.forEach((h, index) => {
      const p = composed[h - 1];
      const ox = (index % SHEET_COLS) * WINDOW4.w;
      const oy = Math.floor(index / SHEET_COLS) * WINDOW4.h;
      for (let y = 0; y < WINDOW4.h; y++) {
        for (let x = 0; x < WINDOW4.w; x++) {
          const c = p.palette[p.indices[y * WINDOW4.w + x] & 15];
          const o = ((oy + y) * width + ox + x) * 4;
          rgba[o] = c.r;
          rgba[o + 1] = c.g;
          rgba[o + 2] = c.b;
          rgba[o + 3] = 255;
        }
      }
      refs[String(h)] = { zone, index, script: p.script };
    });
    sheets.set(zone, { width, height, rgba });
  }

  // Labels from the zones each world draws.
  for (const w of worldList) {
    const zs = Object.entries(w.zones).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([z]) => z);
    const full = w.rooms.filter((r) => r.pics.every(Boolean)).length;
    w.label = `World ${w.id + 1}: ${w.rooms.length} rooms, ${Math.round((100 * full) / w.rooms.length)}% fully pictured (zones ${zs.join(', ')})`;
  }
  const maze: MazeFile = { version: 1, picWidth: WINDOW4.w, picHeight: WINDOW4.h, sheetCols: SHEET_COLS, worlds: worldList, pictures: refs, stats };
  return { maze, sheets };
}

export async function exportWaxworksMaze(dataDir: string): Promise<MazeFile> {
  const { maze, sheets } = buildMaze(dataDir);
  const out = resolve('public/assets', GAME, PLATFORM);
  mkdirSync(resolve(out, 'maze'), { recursive: true });
  mkdirSync(resolve(out, 'data'), { recursive: true });
  for (const [zone, s] of sheets) await writePNG(resolve(out, 'maze', `z${zone}.png`), s.rgba, s.width, s.height);
  await writeJson(resolve(out, 'data', 'maze.json'), maze);
  console.log(
    `waxworks/amiga maze: ${maze.worlds.length} worlds, ${maze.stats.rooms} rooms, ${Object.keys(maze.pictures).length} pictures in ${sheets.size} sheets, ` +
      `${maze.stats.roomPicturesRendered}/${maze.stats.roomPictures} room pictures rendered, ${maze.stats.roomsUncertain} rooms gated by unmodelled conditions`,
  );
  return maze;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dataDir = resolve(process.argv[2] ?? 'data/waxworks/amiga/data');
  if (!existsSync(dataDir)) throw new Error(`no data dir ${dataDir}`);
  exportWaxworksMaze(dataDir).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
