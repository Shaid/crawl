/**
 * Hired Guns (Amiga): walker data. Depacks the RNC1 files it needs (via `ancient`) into
 * build/cache/hiredguns/unpacked/ and writes public/assets/hiredguns/amiga/walker/:
 *   tables.json        view tables + palette copied out of the retail executable (see view.ts)
 *   style0..4.json     unpacked `Styles/StyleNN.gfx` (base64; parsed in the browser by gfxbank.ts)
 *   misc.json          unpacked `Game/Misc.gfx` (water re-tint graphics)
 *   maps/NN.json       per map: header, start, doors, plane-1 cells (base64 BE u32), sky bits
 *   index.json         the level list: map, walkable z-layers, start pose
 *
 *   npx tsx tools/hiredguns/amiga/export-walker.ts [dataDir]
 * Spec: docs/hiredguns/amiga/data-structure.md.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ancientDecompressFile } from '@seer-project/pipeline';
import { assetRoot, writeJson } from '../../shared/asset-paths.ts';
import { LOCN_SIZE, parseMap } from './map.ts';
import { standableNear, walkableLayers, type HgDoor } from './model.ts';
import type { HgViewTables } from './view.ts';
import type { HgIndexEntry } from './assets.ts';

const GAME = 'hiredguns';
const PLATFORM = 'amiga';
const CACHE = resolve('build/cache/hiredguns/unpacked');

/** Retail table locations, file offsets in the RNC1-unpacked `Hired Guns` (142,248 B). */
export const EXE_TABLES = {
  size: 142_248,
  viewBob: 0x1740a, // view_offsets, 67 longs (lea at 0x8608 in blit_view)
  dirOffsets: 0x188fc, // north/east/south/west, 4 x 67 longs (lea at 0x64EC / 0x75FA)
  removal: 0x17624, // block_removal, 67 x 32 words (lea at 0x8576)
  blockRot: 0x8e8e, // block_rotations, 4 x 64 bytes
  auxRot: 0x8fa2, // aux_rotations, 4 x 16 bytes
  gapDist: 0x908c, // blit_block .dist1..dist4, 4 x 11 bytes
  palette: 0x1f996, // game_palette, 32 words (lea at 0x1EEA8)
} as const;

export function readExeTables(exe: Uint8Array): HgViewTables {
  if (exe.length !== EXE_TABLES.size) throw new Error(`hiredguns: unpacked exe is ${exe.length} B, expected ${EXE_TABLES.size}`);
  const dv = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
  const longs = (o: number, n: number) => Array.from({ length: n }, (_, i) => dv.getInt32(o + 4 * i));
  const viewBob = longs(EXE_TABLES.viewBob, 67);
  const dirOffsets = [0, 1, 2, 3].map((f) => longs(EXE_TABLES.dirOffsets + f * 268, 67).map((b) => b / 4));
  const removal = Array.from({ length: 67 }, (_, i) =>
    Array.from({ length: 8 }, (_, c) => Array.from({ length: 4 }, (_, k) => {
      const v = dv.getInt16(EXE_TABLES.removal + i * 64 + c * 8 + k * 2);
      return v < 0 ? -1 : v / 4;
    })));
  const blockRot = Array.from(exe.subarray(EXE_TABLES.blockRot, EXE_TABLES.blockRot + 256));
  const auxRot = Array.from(exe.subarray(EXE_TABLES.auxRot, EXE_TABLES.auxRot + 64));
  const gapDist = [0, 1, 2, 3].map((k) => Array.from(exe.subarray(EXE_TABLES.gapDist + 11 * k, EXE_TABLES.gapDist + 11 * k + 11)));
  const palette = Array.from({ length: 32 }, (_, i) => dv.getUint16(EXE_TABLES.palette + 2 * i));
  // Fingerprints: each must hold or the table offsets are wrong for this build.
  const w = 23, a = 529;
  const expectNorth0 = [(a - 4 * w - 2), (a - 4 * w + 2), (a - 4 * w - 1), (a - 4 * w + 1), (a - 4 * w)];
  const checks: Array<[string, boolean]> = [
    ['north row', expectNorth0.every((v, i) => dirOffsets[0]![i] === v) && dirOffsets[0]![66] === 0],
    ['view_offsets', viewBob[0] === 0 && viewBob[1] === 4 && viewBob[66] === 44 && viewBob.every((v) => v >= 0 && v < 67)],
    ['block_removal', removal[0]![0]!.join() === '55,57,-1,-1'],
    ['block_rotations', blockRot.slice(0, 12).join() === '0,1,2,3,4,5,6,7,11,10,8,9'],
    ['aux_rotations', auxRot.slice(8, 12).join() === '8,9,11,10'],
    ['gap tables', gapDist[0]!.join() === '2,6,9,12,14,16,18,20,21,22,23'],
    ['palette', palette[0] === 0 && palette[1] === 0xedc && palette[6] === 0xfff],
  ];
  const bad = checks.filter(([, ok]) => !ok).map(([n]) => n);
  if (bad.length) throw new Error(`hiredguns: exe table fingerprints failed: ${bad.join(', ')}`);
  return { viewBob, dirOffsets, removal, blockRot, auxRot, gapDist, palette };
}

function unpacked(dataDir: string, rel: string): Uint8Array {
  const out = resolve(CACHE, rel);
  if (!existsSync(out)) {
    mkdirSync(dirname(out), { recursive: true });
    ancientDecompressFile(resolve(dataDir, rel), out);
  }
  return new Uint8Array(readFileSync(out));
}

/** The map's `doors[32]` table (struct map + 9616: u16 posn, u8 trig, u8 direction, u32 type, u8 delay, count, key, button_only). */
export function readDoors(buf: Uint8Array): HgDoor[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out: HgDoor[] = [];
  for (let k = 0; k < 32; k++) {
    const o = LOCN_SIZE + 9616 + 12 * k;
    const posn = dv.getUint16(o);
    if (!posn) continue;
    out.push({ cell: posn / 4, direction: buf[o + 3]!, key: buf[o + 10]!, buttonOnly: buf[o + 11] === 0xff });
  }
  return out;
}

const b64 = (a: Uint8Array) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');


export function exportHiredGunsWalker(dataDirArg = 'data/hiredguns/amiga'): { maps: number; levels: number } | null {
  const dataDir = existsSync(resolve(dataDirArg, 'game')) ? resolve(dataDirArg, 'game') : resolve(dataDirArg);
  if (!existsSync(resolve(dataDir, 'Hired Guns'))) return null;
  const root = resolve(assetRoot(GAME, PLATFORM), 'walker');
  mkdirSync(resolve(root, 'maps'), { recursive: true });

  writeJson(resolve(root, 'tables.json'), readExeTables(unpacked(dataDir, 'Hired Guns')), false);
  for (let s = 0; s <= 4; s++) writeJson(resolve(root, `style${s}.json`), { data: b64(unpacked(dataDir, `Styles/Style0${s}.gfx`)) }, false);
  writeJson(resolve(root, 'misc.json'), { data: b64(unpacked(dataDir, 'Game/Misc.gfx')) }, false);

  const index: HgIndexEntry[] = [];
  const files = readdirSync(resolve(dataDir, 'Maps')).filter((f) => /^\d\d\.map$/.test(f)).sort();
  for (const f of files) {
    const buf = unpacked(dataDir, `Maps/${f}`);
    const m = parseMap(buf);
    const doors = readDoors(buf);
    const cellsBE = new Uint8Array(m.cells.length * 4);
    const dv = new DataView(cellsBE.buffer);
    m.cells.forEach((v, i) => dv.setUint32(4 * i, v));
    const world = { cells: m.cells, doors };
    const layers = walkableLayers(world);
    const p = m.players[0]!;
    const start = { x: p.x, y: p.y, z: p.z, facing: 0 };
    if (!layers.includes(p.z)) {
      const alt = standableNear(world, layers[0] ?? p.z);
      if (alt) Object.assign(start, alt);
    }
    writeJson(resolve(root, `maps/${f.slice(0, 2)}.json`), {
      num: m.num, title: m.title, name: m.name, style: m.style, sky: m.sky, mons: m.mons,
      players: m.players, exit: m.exit, timeLimit: m.timeLimit, doors, cells: b64(cellsBE), sky4: b64(m.sky4),
    }, false);
    index.push({ num: m.num, title: m.title, style: m.style, layers, start });
  }
  writeJson(resolve(root, 'index.json'), { maps: index });
  return { maps: index.length, levels: index.reduce((n, e) => n + e.layers.length, 0) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = exportHiredGunsWalker(process.argv[2]);
  console.log(r ? `hiredguns/amiga walker: ${r.maps} maps, ${r.levels} walkable layers` : 'hiredguns/amiga: data not found');
}
