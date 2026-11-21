/**
 * Perihelion (Amiga): first-person walker data. Emits to public/assets/perihelion/amiga/walker/:
 *   walker.json        palette, the 5 dungeon grids (+ start pose, atlas file), both composers'
 *                      piece / destination tables and every leaf routine they call, decoded from
 *                      the main program (see exe.ts / view-model.ts for the addresses)
 *   atlas-<n>.bin      dungeon n's view atlas as raw palette indices (w*h bytes, row-major)
 *   npx tsx tools/perihelion/amiga/export-walker.ts
 * Decoded intermediates go to build/cache/perihelion/ (dungeon grids as text).
 * Spec: docs/perihelion/amiga/data-structure.md "First-person dungeons".
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assetRoot, writeJson } from '../../shared/asset-paths.ts';
import {
  MainProgram, dataDir, tableFileNames, readPalette, readDungeons, readPieces, readDests, decodeLeaf, decodeInterleaved,
  FAR_PIECES, FAR_PIECE_COUNT, FAR_DESTS, FAR_DEST_COUNT, NEAR_PIECES, NEAR_PIECE_COUNT, NEAR_DESTS, NEAR_DEST_COUNT,
  type Leaf,
} from './exe.ts';
import { FAR_LEAVES, NEAR_LEAVES, leafKey } from './view-model.ts';

const GAME = 'perihelion';
const PLATFORM = 'amiga';

/** Module titles of the per-dungeon music (`$BEDEA`), used as the level names. */
function modTitle(bytes: Uint8Array): string {
  const t = bytes.subarray(0, 20);
  const e = t.indexOf(0);
  return Buffer.from(t.subarray(0, e < 0 ? 20 : e)).toString('latin1');
}

export interface WalkerJson {
  source: string;
  palette: number[];
  dungeons: Array<{
    index: number; name: string; kind: 'far' | 'near'; width: number; height: number; mapAddr: string;
    cells: number[]; start: { x: number; y: number; facing: number };
    atlas: { file: string; source: string; w: number; h: number };
  }>;
  composers: {
    far: { pieces: ReturnType<typeof readPieces>; dests: ReturnType<typeof readDests> };
    near: { pieces: ReturnType<typeof readPieces>; dests: ReturnType<typeof readDests> };
  };
  leaves: Record<string, Leaf>;
}

export function buildWalker(dir = dataDir()): { json: WalkerJson; atlases: Map<number, Uint8Array> } {
  const p = MainProgram.load(dir);
  const names = tableFileNames(new Uint8Array(readFileSync(resolve(dir, 'Table.Dat'))));
  const leaves: Record<string, Leaf> = {};
  for (const a of [...FAR_LEAVES, ...NEAR_LEAVES]) leaves[leafKey(a)] = { p0: decodeLeaf(p, a, 0), p1: decodeLeaf(p, a, 1) };
  const atlases = new Map<number, Uint8Array>();
  const dungeons = readDungeons(p).map((d) => {
    // $C2A88: dungeon 1 takes the near composer and its 416-px atlas (260 B/row in $C3332)
    const kind = d.index === 1 ? 'near' as const : 'far' as const;
    const atlasName = names[d.atlasFile]!;
    const bm = decodeInterleaved(new Uint8Array(readFileSync(resolve(dir, atlasName))), kind === 'near' ? 416 : 352);
    atlases.set(d.index, bm.px);
    return {
      index: d.index,
      name: modTitle(new Uint8Array(readFileSync(resolve(dir, names[d.modFile]!)))),
      kind, width: d.width, height: d.height, mapAddr: `$${d.mapAddr.toString(16).toUpperCase()}`,
      cells: d.cells, start: d.start,
      atlas: { file: `atlas-${d.index}.bin`, source: atlasName, w: bm.w, h: bm.h },
    };
  });
  return {
    json: {
      source: 'main program 000316B00105D570 (loaded at $80000); docs/perihelion/amiga/data-structure.md',
      palette: readPalette(p),
      dungeons,
      composers: {
        far: { pieces: readPieces(p, FAR_PIECES, FAR_PIECE_COUNT), dests: readDests(p, FAR_DESTS, FAR_DEST_COUNT) },
        near: { pieces: readPieces(p, NEAR_PIECES, NEAR_PIECE_COUNT), dests: readDests(p, NEAR_DESTS, NEAR_DEST_COUNT) },
      },
      leaves,
    },
    atlases,
  };
}

export function exportWalker(dir = dataDir()): { dungeons: number; leaves: number } {
  const { json, atlases } = buildWalker(dir);
  const root = resolve(assetRoot(GAME, PLATFORM), 'walker');
  const cache = resolve('build/cache', GAME);
  mkdirSync(root, { recursive: true });
  mkdirSync(cache, { recursive: true });
  writeJson(resolve(root, 'walker.json'), json, false);
  for (const [i, px] of atlases) writeFileSync(resolve(root, `atlas-${i}.bin`), px);
  const glyph = '.#+3456789';
  for (const d of json.dungeons) {
    const rows: string[] = [];
    for (let y = 0; y < d.height; y++) rows.push(d.cells.slice(y * d.width, (y + 1) * d.width).map((v) => glyph[v] ?? '?').join(''));
    writeFileSync(resolve(cache, `dungeon${d.index}-${d.name}.txt`), rows.join('\n') + '\n');
  }
  return { dungeons: json.dungeons.length, leaves: Object.keys(json.leaves).length };
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(exportWalker());
